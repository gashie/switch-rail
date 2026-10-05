import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { canonicalJsonBytes, canonicalJson } from '../../core/json.js';
import { config } from '../../core/config.js';
import { auditService } from '../audit/index.js';
import { directoryService } from '../directory/index.js';
import { createEnvelope } from '../envelope/index.js';
import { transactionsOrchestrator, transactionsService } from '../transactions/index.js';
import { cryptoKeysService } from '../crypto-keys/index.js';
import { OVERLAY_TYPE, REFUND_STATES } from './codes.js';

const monthBucket = (d = new Date()) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const formatRefundNumber = (bucket, seq) => `REF-${bucket}-${String(seq).padStart(6, '0')}`;

const findRailKid = async () => {
  const keys = await cryptoKeysService.listActive({ ownerType: 'rail', ownerId: null });
  if (keys.length === 0) {
    throw new AppError('CONFLICT', 'no active rail signing key', 503);
  }
  return keys[0].kid;
};

const ageInDays = (timestamp) => {
  if (!timestamp) return Infinity;
  const t = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  return Math.floor((Date.now() - t) / 86_400_000);
};

export const createRefundsService = ({ db, model }) => {
  const initiate = async ({
    originalTransactionId,
    initiatedByParticipant,
    amountMinor,
    reasonCode,
    reasonMessage
  }) => {
    // Validate the original transaction.
    const original = await transactionsService.findById(originalTransactionId);
    if (!original) {
      throw new AppError('NOT_FOUND', `transaction ${originalTransactionId} not found`, 404);
    }
    if (original.state !== 'CONFIRMED') {
      throw new AppError(
        'CONFLICT',
        `refund requires CONFIRMED original (state=${original.state})`,
        409
      );
    }
    // Beneficiary participant of the original is the only legitimate refund initiator.
    if (initiatedByParticipant !== original.beneficiary_participant) {
      throw new AppError(
        'CONFLICT',
        `only the beneficiary participant ${original.beneficiary_participant} can initiate a refund (got ${initiatedByParticipant})`,
        409
      );
    }
    // Window check.
    const windowDays = config.refundWindowDays;
    if (ageInDays(original.confirmed_at) > windowDays) {
      throw new AppError('CONFLICT', `refund window expired (${windowDays} days)`, 409);
    }
    // Amount cap.
    const previouslyRefunded = await db.withClient((c) => model.sumCompletedForOriginal(c, originalTransactionId));
    const newTotal = BigInt(previouslyRefunded) + BigInt(amountMinor);
    if (newTotal > BigInt(original.amount_value)) {
      throw new AppError(
        'CONFLICT',
        `refund total ${newTotal} would exceed original amount ${original.amount_value}`,
        409
      );
    }
    if (BigInt(amountMinor) <= 0n) {
      throw new AppError('VALIDATION_FAILED', 'refund amount must be > 0', 400);
    }

    // Resolve party accounts (refund originator = original beneficiary;
    // refund beneficiary = original originator).
    const refundOrig = await directoryService.findByAccount({
      participantCode: original.beneficiary_participant,
      accountNumber: original.beneficiary_account
    });
    const refundBene = await directoryService.findByAccount({
      participantCode: original.originator_participant,
      accountNumber: original.originator_account
    });
    if (!refundOrig || !refundBene) {
      throw new AppError('NOT_FOUND', 'refund party account missing', 404);
    }

    // Persist a PROCESSING refund row first so the link_signature_b64 column
    // is filled when we insert. We sign once we know the refund ID.
    const id = uuidv7();
    const bucket = monthBucket();
    const refund = await db.withTransaction(async (client) => {
      const seq = await model.bumpSequence(client, bucket);
      const refundNumber = formatRefundNumber(bucket, seq);
      const railKid = await findRailKid();
      const sigPayload = { originalTxId: originalTransactionId, refundId: id, amountMinor: String(amountMinor) };
      const signed = await cryptoKeysService.sign({ kid: railKid, payload: canonicalJsonBytes(sigPayload) });
      const inserted = await model.insert(client, {
        id,
        refundNumber,
        originalTransactionId,
        initiatedByParticipant,
        amountMinor,
        currency: original.amount_currency,
        reasonCode,
        reasonMessage,
        linkSignatureB64: signed.signature,
        linkSignatureKid: railKid
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'refund.initiated',
        resourceType: 'refund',
        resourceId: id,
        payload: { refundNumber, originalTransactionId, amountMinor: String(amountMinor), reasonCode }
      });
      return inserted;
    });

    // Build the CRDT_TRF envelope (beneficiary → originator).
    const envelope = createEnvelope({
      msgType: 'CRDT_TRF',
      sourceFormat: 'REST',
      sourceMessageId: `ref-${id}`,
      endToEndId: `ref-${id}`,
      idempotencyKey: `ref-${id}`,
      originator: {
        participantCode: original.beneficiary_participant,
        accountId: refundOrig.account_number,
        accountType: refundOrig.account_type === 'AGENT_FLOAT' ? 'BANK_ACCOUNT' : refundOrig.account_type,
        name: refundOrig.account_name,
        countryCode: 'GH'
      },
      beneficiary: {
        participantCode: original.originator_participant,
        accountId: refundBene.account_number,
        accountType: refundBene.account_type === 'AGENT_FLOAT' ? 'BANK_ACCOUNT' : refundBene.account_type,
        name: refundBene.account_name,
        countryCode: 'GH'
      },
      amount: { value: String(amountMinor), currency: original.amount_currency },
      reference: `Refund ${refund.refund_number}`,
      remittance: reasonMessage,
      purposeCode: 'GDDS',
      settlementMethod: 'CLRG',
      metadata: {
        overlay: { type: OVERLAY_TYPE, overlayId: id, refundNumber: refund.refund_number, originalTransactionId, reasonCode }
      }
    });

    const orchResult = await transactionsOrchestrator.process(envelope);
    const tx = orchResult.transaction;
    const success = tx.state === 'CONFIRMED';

    return db.withTransaction(async (client) => {
      const updated = await model.setState(client, {
        id,
        toState: success ? REFUND_STATES.COMPLETED : REFUND_STATES.FAILED,
        fields: {
          refund_transaction_id: tx.id,
          completed_at: success ? new Date().toISOString() : null
        }
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: success ? 'refund.completed' : 'refund.failed',
        resourceType: 'refund',
        resourceId: id,
        payload: { refundNumber: refund.refund_number, transactionId: tx.id, txState: tx.state }
      });
      return { refund: updated, transaction: tx };
    });
  };

  const findByNumber = (n) => db.withClient((c) => model.findByNumber(c, n));
  const findById = (id) => db.withClient((c) => model.findById(c, id));
  const list = (filters) => db.withClient((c) => model.list(c, filters));
  const listForOriginal = (origId) => db.withClient((c) => model.listForOriginal(c, origId));

  // Verifier helper: reproduce the signed payload + return the kid + signature.
  const linkSignaturePayload = async (id) => {
    const r = await findById(id);
    if (!r) return null;
    const payload = {
      originalTxId: r.original_transaction_id,
      refundId: r.id,
      amountMinor: String(r.amount_minor)
    };
    return {
      payload,
      payloadCanonical: canonicalJson(payload),
      signature: r.link_signature_b64,
      kid: r.link_signature_kid
    };
  };

  return { initiate, findByNumber, findById, list, listForOriginal, linkSignaturePayload };
};
