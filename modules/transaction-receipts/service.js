import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { canonicalJsonBytes } from '../../core/json.js';
import { auditService } from '../audit/index.js';
import { cryptoKeysService } from '../crypto-keys/index.js';
import { transactionsService } from '../transactions/index.js';

/**
 * Build the canonical receipt body. The same shape is signed AND stored,
 * so verifiers downstream (banks, regulators, dispute adjudicators) can
 * recompute canonicalJsonBytes(payload) and verify against the rail's
 * stored public key without any field-by-field reconstruction.
 */
const buildPayload = ({ transaction, party, participantCode, issuedAt }) => ({
  transactionId: transaction.id,
  envelopeId: transaction.envelope_id,
  endToEndId: transaction.end_to_end_id,
  amount: {
    value: String(transaction.amount_value),
    currency: transaction.amount_currency
  },
  originatorParticipant: transaction.originator_participant,
  originatorAccount: transaction.originator_account,
  beneficiaryParticipant: transaction.beneficiary_participant,
  beneficiaryAccount: transaction.beneficiary_account,
  responseCode: transaction.response_code || 'ACSC',
  confirmedAt: transaction.confirmed_at?.toISOString?.() || transaction.confirmed_at || null,
  issuedAt,
  party,
  participantCode
});

const findRailKid = async () => {
  const keys = await cryptoKeysService.listActive({ ownerType: 'rail', ownerId: null });
  if (keys.length === 0) {
    throw new AppError(
      'CONFLICT',
      'no active rail signing key — receipts cannot be issued',
      503
    );
  }
  return keys[0].kid;
};

export const createReceiptsService = ({ db, model }) => {
  /**
   * Issue receipts for both ORIGINATOR and BENEFICIARY in one go. Designed
   * to run inside the orchestrator's outer transaction (or recovery's
   * deciding transaction) so receipt issuance and the CONFIRMED transition
   * commit together — there is no observable window where a CONFIRMED
   * transaction has no receipts.
   */
  const issueReceiptsOnClient = async (client, transaction) => {
    if (transaction.state !== 'CONFIRMED') {
      throw new AppError(
        'CONFLICT',
        `cannot issue receipts for transaction in state ${transaction.state}`,
        409
      );
    }
    const railKid = await findRailKid();
    const issuedAt = new Date().toISOString();
    const out = [];
    for (const [party, participantCode] of [
      ['ORIGINATOR', transaction.originator_participant],
      ['BENEFICIARY', transaction.beneficiary_participant]
    ]) {
      const payload = buildPayload({ transaction, party, participantCode, issuedAt });
      const sig = await cryptoKeysService.sign({
        kid: railKid,
        payload: canonicalJsonBytes(payload)
      });
      const inserted = await model.insert(client, {
        id: uuidv7(),
        transactionId: transaction.id,
        party,
        participantCode,
        payload,
        signatureB64: sig.signature,
        signatureKid: sig.kid,
        signatureAlg: sig.alg
      });
      const row = inserted || (await model.findByTransactionAndParty(client, transaction.id, party));
      if (!row) {
        throw new AppError('INTERNAL', `receipt insert failed for ${party}`, 500);
      }
      out.push(row);
    }
    await auditService.record(client, {
      actorType: 'system',
      eventType: 'transaction.receipts.issued',
      resourceType: 'transaction',
      resourceId: transaction.id,
      payload: { kid: railKid, count: out.length, issuedAt }
    });
    return out;
  };

  const issueReceipts = (clientOrTx, maybeTx) => {
    if (clientOrTx && typeof clientOrTx.query === 'function') {
      return issueReceiptsOnClient(clientOrTx, maybeTx);
    }
    return db.withTransaction((c) => issueReceiptsOnClient(c, clientOrTx));
  };

  const findForTransaction = async (transactionId) => {
    const tx = await transactionsService.findById(transactionId);
    if (!tx) return { found: false, receipts: [] };
    const receipts = await db.withClient((c) => model.findByTransaction(c, transactionId));
    return { found: true, transaction: tx, receipts };
  };

  const verify = async ({ payload, signature, kid }) => {
    if (!payload || typeof payload !== 'object') {
      return { valid: false, reason: 'payload must be an object' };
    }
    if (!signature || !kid) {
      return { valid: false, reason: 'signature and kid are required' };
    }
    const bytes = canonicalJsonBytes(payload);
    const valid = await cryptoKeysService.verify({ kid, payload: bytes, signature });
    return { valid, kid };
  };

  const listForParticipant = (participantCode, opts) =>
    db.withClient((c) => model.listForParticipant(c, participantCode, opts));

  return {
    issueReceipts,
    findForTransaction,
    verify,
    listForParticipant,
    _internal: {
      issueReceiptsOnClient
    }
  };
};
