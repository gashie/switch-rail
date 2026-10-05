import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { directoryService } from '../directory/index.js';
import { createEnvelope } from '../envelope/index.js';
import { transactionsOrchestrator } from '../transactions/index.js';
import { OVERLAY_TYPES, DEFAULT_EXPIRY_HOURS } from './codes.js';
import { STATES, isTerminal } from './states.js';

const monthBucket = (d = new Date()) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

const formatRequestNumber = (bucket, seq) =>
  `R2P-${bucket}-${String(seq).padStart(6, '0')}`;

export const createR2pService = ({ db, model }) => {
  const create = async (input) => {
    const {
      requesterParticipant,
      requesterAccountNumber,
      payerParticipant,
      payerAccountNumber,
      payerAliasType,
      payerAliasValue,
      amountMinor,
      currency,
      reason,
      reference,
      expiresInHours,
      idempotencyKey
    } = input;

    // Idempotency short-circuit.
    if (idempotencyKey) {
      const existing = await db.withClient((c) =>
        model.findByIdemKey(c, { requesterParticipant, idempotencyKey })
      );
      if (existing) return existing;
    }

    // Resolve requester account UUID.
    const requesterAccount = await directoryService.findByAccount({
      participantCode: requesterParticipant,
      accountNumber: requesterAccountNumber
    });
    if (!requesterAccount) {
      throw new AppError('NOT_FOUND', `requester account ${requesterParticipant}/${requesterAccountNumber} not found`, 404);
    }

    // Optionally resolve payer account if number provided.
    let payerAccountId = null;
    if (payerAccountNumber) {
      const payerAccount = await directoryService
        .findByAccount({ participantCode: payerParticipant, accountNumber: payerAccountNumber })
        .catch(() => null);
      if (payerAccount) payerAccountId = payerAccount.id;
    }

    return db.withTransaction(async (client) => {
      const bucket = monthBucket();
      const seq = await model.bumpSequence(client, bucket);
      const requestNumber = formatRequestNumber(bucket, seq);
      const id = uuidv7();
      const expiresAt = new Date(Date.now() + (expiresInHours ?? DEFAULT_EXPIRY_HOURS) * 3600_000).toISOString();

      const inserted = await model.insert(client, {
        id,
        requestNumber,
        requesterParticipant,
        requesterAccountId: requesterAccount.id,
        payerParticipant,
        payerAccountId,
        payerAliasType,
        payerAliasValue,
        amountMinor,
        currency,
        reason,
        reference,
        expiresAt,
        idempotencyKey
      });

      // ON CONFLICT DO NOTHING returns no row when the idem-key already
      // existed but the earlier check missed (race). Re-fetch.
      if (!inserted && idempotencyKey) {
        return model.findByIdemKey(client, { requesterParticipant, idempotencyKey });
      }

      await auditService.record(client, {
        actorType: 'system',
        eventType: 'r2p.created',
        resourceType: 'r2p_request',
        resourceId: id,
        payload: {
          requestNumber,
          requesterParticipant,
          payerParticipant,
          amountMinor: String(amountMinor),
          currency
        }
      });
      return inserted;
    });
  };

  const findByRequestNumber = (n) => db.withClient((c) => model.findByRequestNumber(c, n));
  const findById = (id) => db.withClient((c) => model.findById(c, id));
  const list = (filters) => db.withClient((c) => model.list(c, filters));

  // Authorize: build a CRDT_TRF envelope payer→requester and run it through
  // the orchestrator. Idempotent: re-authorizing an already-PAID request
  // returns the existing transaction.
  const authorize = async ({ requestNumber, payerAccountNumber, payerName, authorizedByUser }) => {
    const r = await findByRequestNumber(requestNumber);
    if (!r) throw new AppError('NOT_FOUND', `r2p ${requestNumber} not found`, 404);
    if (r.state === STATES.PAID && r.paid_transaction_id) {
      return { request: r, transactionId: r.paid_transaction_id, deduped: true };
    }
    if (isTerminal(r.state)) {
      throw new AppError(
        'CONFLICT',
        `r2p ${requestNumber} is in terminal state ${r.state}`,
        409
      );
    }
    if (new Date(r.expires_at).getTime() <= Date.now()) {
      // Mark expired and reject.
      await db.withTransaction(async (client) => {
        await model.setState(client, { id: r.id, toState: STATES.EXPIRED });
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'r2p.expired',
          resourceType: 'r2p_request',
          resourceId: r.id,
          payload: { requestNumber }
        });
      });
      throw new AppError('CONFLICT', `r2p ${requestNumber} has expired`, 409);
    }

    const payerAccount = await directoryService.findByAccount({
      participantCode: r.payer_participant,
      accountNumber: payerAccountNumber
    });
    if (!payerAccount) {
      throw new AppError('NOT_FOUND', `payer account ${r.payer_participant}/${payerAccountNumber} not found`, 404);
    }
    const requesterAccountRow = await directoryService.findById(r.requester_account_id);
    if (!requesterAccountRow) {
      throw new AppError('NOT_FOUND', `requester account ${r.requester_account_id} missing`, 404);
    }

    // Build the CRDT_TRF envelope. Overlay tag in metadata.
    const envelope = createEnvelope({
      msgType: 'CRDT_TRF',
      sourceFormat: 'REST',
      sourceMessageId: `r2p-${r.id}`,
      endToEndId: `r2p-${r.id}`,
      idempotencyKey: `r2p-pay-${r.id}`,
      originator: {
        participantCode: r.payer_participant,
        accountId: payerAccountNumber,
        accountType: payerAccount.account_type,
        name: payerName,
        countryCode: 'GH'
      },
      beneficiary: {
        participantCode: r.requester_participant,
        accountId: requesterAccountRow.account_number,
        accountType: requesterAccountRow.account_type,
        name: requesterAccountRow.account_name,
        countryCode: 'GH'
      },
      amount: { value: String(r.amount_minor), currency: r.currency },
      reference: r.reference || `R2P ${requestNumber}`,
      purposeCode: 'GDDS',
      settlementMethod: 'CLRG',
      metadata: {
        overlay: {
          type: OVERLAY_TYPES.R2P_AUTHORIZE,
          overlayId: r.id,
          requestNumber
        }
      }
    });

    const result = await transactionsOrchestrator.process(envelope);

    // Mark AUTHORIZED → PAID/REJECTED based on tx outcome.
    return db.withTransaction(async (client) => {
      const tx = result.transaction;
      const now = new Date().toISOString();
      let updated;
      if (tx.state === 'CONFIRMED') {
        // Pass through AUTHORIZED state and then PAID atomically.
        await model.setState(client, {
          id: r.id,
          toState: STATES.AUTHORIZED,
          fields: { authorized_at: now }
        });
        updated = await model.setState(client, {
          id: r.id,
          toState: STATES.PAID,
          fields: { paid_transaction_id: tx.id }
        });
        await auditService.record(client, {
          actorType: authorizedByUser ? 'user' : 'system',
          actorId: authorizedByUser || null,
          eventType: 'r2p.paid',
          resourceType: 'r2p_request',
          resourceId: r.id,
          payload: { requestNumber, transactionId: tx.id }
        });
      } else {
        updated = await model.setState(client, {
          id: r.id,
          toState: STATES.REJECTED,
          fields: { rejected_reason: tx.reason_code || `tx_${tx.state}` }
        });
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'r2p.payment_failed',
          resourceType: 'r2p_request',
          resourceId: r.id,
          payload: { requestNumber, txState: tx.state, reasonCode: tx.reason_code }
        });
      }
      return { request: updated, transactionId: tx.id, transactionState: tx.state, deduped: false };
    });
  };

  const reject = async ({ requestNumber, reason, notes, rejectedByUser }) =>
    db.withTransaction(async (client) => {
      const r = await model.findByRequestNumber(client, requestNumber);
      if (!r) throw new AppError('NOT_FOUND', `r2p ${requestNumber} not found`, 404);
      if (isTerminal(r.state)) {
        throw new AppError('CONFLICT', `r2p ${requestNumber} is in terminal state ${r.state}`, 409);
      }
      const updated = await model.setState(client, {
        id: r.id,
        toState: STATES.REJECTED,
        fields: { rejected_reason: reason }
      });
      await auditService.record(client, {
        actorType: rejectedByUser ? 'user' : 'system',
        actorId: rejectedByUser || null,
        eventType: 'r2p.rejected',
        resourceType: 'r2p_request',
        resourceId: r.id,
        payload: { requestNumber, reason, notes }
      });
      return updated;
    });

  // Worker: expires PENDING requests past expires_at.
  const expirePending = async () =>
    db.withTransaction(async (client) => {
      const expired = await model.expirePending(client, 500);
      for (const e of expired) {
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'r2p.expired',
          resourceType: 'r2p_request',
          resourceId: e.id,
          payload: { requestNumber: e.request_number }
        });
      }
      return { count: expired.length };
    });

  return { create, findByRequestNumber, findById, list, authorize, reject, expirePending };
};
