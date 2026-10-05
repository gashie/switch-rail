import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { directoryService } from '../directory/index.js';
import { createEnvelope } from '../envelope/index.js';
import { transactionsOrchestrator } from '../transactions/index.js';
import { encodeMpm } from './emvco-encoder.js';
import { decodeMpm } from './emvco-decoder.js';
import { QR_TYPES } from './codes.js';

export const createQrService = ({ db, model }) => {
  const createStatic = async ({
    merchantParticipant,
    merchantAccountNumber,
    mcc,
    currency = 'GHS',
    merchantName,
    merchantCity
  }) => {
    const account = await directoryService.findByAccount({
      participantCode: merchantParticipant,
      accountNumber: merchantAccountNumber
    });
    if (!account) {
      throw new AppError('NOT_FOUND', `merchant account ${merchantParticipant}/${merchantAccountNumber} not found`, 404);
    }
    const encoded = encodeMpm({
      qrType: QR_TYPES.STATIC,
      merchantParticipant,
      merchantAccountValue: merchantAccountNumber,
      mcc,
      currency,
      merchantName,
      merchantCity
    });
    return db.withTransaction(async (client) => {
      const id = uuidv7();
      const inserted = await model.insert(client, {
        id,
        qrType: QR_TYPES.STATIC,
        merchantParticipant,
        merchantAccountId: account.id,
        merchantName,
        merchantCity,
        mcc,
        currency,
        encodedPayload: encoded
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'qr.created',
        resourceType: 'qr_code',
        resourceId: id,
        payload: { qrType: 'STATIC', merchantParticipant, merchantAccountNumber }
      });
      return inserted;
    });
  };

  const createDynamic = async ({
    merchantParticipant,
    merchantAccountNumber,
    mcc,
    amountMinor,
    currency = 'GHS',
    merchantName,
    merchantCity,
    reference,
    expiresInSeconds = 3600
  }) => {
    const account = await directoryService.findByAccount({
      participantCode: merchantParticipant,
      accountNumber: merchantAccountNumber
    });
    if (!account) {
      throw new AppError('NOT_FOUND', `merchant account ${merchantParticipant}/${merchantAccountNumber} not found`, 404);
    }
    const ref = reference || uuidv7().replace(/-/g, '').slice(0, 20);
    const encoded = encodeMpm({
      qrType: QR_TYPES.DYNAMIC,
      merchantParticipant,
      merchantAccountValue: merchantAccountNumber,
      mcc,
      currency,
      amountMinor,
      merchantName,
      merchantCity,
      reference: ref
    });
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    return db.withTransaction(async (client) => {
      const id = uuidv7();
      const inserted = await model.insert(client, {
        id,
        qrType: QR_TYPES.DYNAMIC,
        merchantParticipant,
        merchantAccountId: account.id,
        merchantName,
        merchantCity,
        mcc,
        amountMinor,
        currency,
        reference: ref,
        expiresAt,
        encodedPayload: encoded
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'qr.created',
        resourceType: 'qr_code',
        resourceId: id,
        payload: { qrType: 'DYNAMIC', merchantParticipant, amountMinor: String(amountMinor) }
      });
      return { ...inserted, reference: ref };
    });
  };

  const decode = (encodedPayload) => decodeMpm(encodedPayload);

  const findById = (id) => db.withClient((c) => model.findById(c, id));

  // Pay flow: decode → look up the merchant by GUI/participant/account →
  // build CRDT_TRF envelope → run through orchestrator → mark CONSUMED for
  // dynamic QRs. Uses outer withTransaction to prevent two concurrent
  // payers consuming the same dynamic QR.
  const pay = async ({
    encodedPayload,
    payerParticipant,
    payerAccountNumber,
    payerName,
    amountMinorOverride
  }) => {
    const decoded = decode(encodedPayload);
    return db.withTransaction(async (client) => {
      const qrRow = await model.findByEncoded(client, encodedPayload);
      if (!qrRow) {
        throw new AppError('NOT_FOUND', 'QR not registered with rail', 404);
      }
      if (qrRow.state !== 'ACTIVE') {
        throw new AppError(
          'CONFLICT',
          `QR ${qrRow.id} is in state ${qrRow.state}; cannot pay`,
          409
        );
      }
      if (qrRow.qr_type === 'DYNAMIC' && qrRow.expires_at && new Date(qrRow.expires_at).getTime() <= Date.now()) {
        await model.setState(client, { id: qrRow.id, toState: 'EXPIRED' });
        throw new AppError('CONFLICT', `QR ${qrRow.id} has expired`, 409);
      }

      // Resolve amount.
      let amountMinor;
      if (qrRow.qr_type === 'DYNAMIC') {
        amountMinor = String(qrRow.amount_minor);
      } else {
        if (!amountMinorOverride) {
          throw new AppError('VALIDATION_FAILED', 'STATIC QR requires amountMinorOverride', 400);
        }
        amountMinor = String(amountMinorOverride);
      }

      const payerAccount = await directoryService.findByAccount({
        participantCode: payerParticipant,
        accountNumber: payerAccountNumber
      });
      if (!payerAccount) {
        throw new AppError('NOT_FOUND', `payer account ${payerParticipant}/${payerAccountNumber} not found`, 404);
      }
      const merchantAccount = await directoryService.findById(qrRow.merchant_account_id);
      if (!merchantAccount) {
        throw new AppError('NOT_FOUND', `merchant account ${qrRow.merchant_account_id} missing`, 404);
      }

      const envelope = createEnvelope({
        msgType: 'CRDT_TRF',
        sourceFormat: 'REST',
        sourceMessageId: `qr-${qrRow.id}-${Date.now()}`,
        endToEndId: `qr-${qrRow.id}-${Date.now()}`,
        idempotencyKey: `qr-pay-${qrRow.id}-${qrRow.qr_type === 'DYNAMIC' ? qrRow.reference : `${payerParticipant}-${Date.now()}`}`,
        originator: {
          participantCode: payerParticipant,
          accountId: payerAccountNumber,
          accountType: payerAccount.account_type,
          name: payerName,
          countryCode: 'GH'
        },
        beneficiary: {
          participantCode: qrRow.merchant_participant,
          accountId: merchantAccount.account_number,
          accountType: merchantAccount.account_type,
          name: qrRow.merchant_name,
          countryCode: 'GH'
        },
        amount: { value: amountMinor, currency: qrRow.currency },
        reference: qrRow.reference || `QR ${qrRow.id.slice(0, 8)}`,
        purposeCode: 'GDDS',
        settlementMethod: 'CLRG',
        metadata: {
          overlay: { type: 'QR_PAY', overlayId: qrRow.id, qrType: qrRow.qr_type, decoded }
        }
      });

      const result = await transactionsOrchestrator.process(envelope);
      const tx = result.transaction;

      // For dynamic QRs, mark CONSUMED on first successful confirmation.
      // Static QRs stay ACTIVE so they can be paid again.
      let updatedQr = qrRow;
      if (qrRow.qr_type === 'DYNAMIC' && tx.state === 'CONFIRMED') {
        updatedQr = await model.setState(client, {
          id: qrRow.id,
          toState: 'CONSUMED',
          fields: { consumed_transaction_id: tx.id }
        });
      }

      await auditService.record(client, {
        actorType: 'system',
        eventType: 'qr.paid',
        resourceType: 'qr_code',
        resourceId: qrRow.id,
        payload: { transactionId: tx.id, txState: tx.state, amountMinor }
      });

      return { qr: updatedQr, transaction: tx };
    });
  };

  const revoke = async ({ id }) =>
    db.withTransaction(async (client) => {
      const r = await model.findById(client, id);
      if (!r) throw new AppError('NOT_FOUND', `QR ${id} not found`, 404);
      if (r.qr_type !== 'STATIC') {
        throw new AppError('CONFLICT', `only static QRs can be revoked; ${id} is ${r.qr_type}`, 409);
      }
      if (r.state !== 'ACTIVE') {
        throw new AppError('CONFLICT', `QR ${id} is in state ${r.state}`, 409);
      }
      const updated = await model.setState(client, { id, toState: 'REVOKED' });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'qr.revoked',
        resourceType: 'qr_code',
        resourceId: id,
        payload: {}
      });
      return updated;
    });

  return { createStatic, createDynamic, decode, pay, revoke, findById };
};
