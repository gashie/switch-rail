// Escrow overlay — money flows between a participant settlement account and
// the rail-internal RAIL_ESCROW ledger account. Because the destination is
// not a participant (no credit-leg endpoint), we follow the same precedent
// as Phase 7's dispute-reserve hold: post the 2-leg ledger journal directly
// via ledgerService rather than the orchestrator. The orchestrator-bypass
// is contained to this rail-internal flow; any participant↔participant leg
// (e.g. a settlement that originated as an escrow release feeding into a
// downstream pay-out) still flows through the orchestrator.

import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { directoryService } from '../directory/index.js';
import {
  ACCOUNT_TYPES,
  JOURNAL_REASONS,
  accountCodeFor,
  ledgerService
} from '../ledger/index.js';
import { OVERLAY_TYPE_HOLD, OVERLAY_TYPE_RELEASE } from './codes.js';
import { STATES, isTerminal, canTransition } from './states.js';

const monthBucket = (d = new Date()) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const formatNumber = (bucket, seq) => `ESC-${bucket}-${String(seq).padStart(6, '0')}`;
const todayUtc = () => new Date().toISOString().slice(0, 10);

const postJournal = async (client, { reason, escrowRow, currency, fromAccountCode, toAccountCode, action }) => {
  const amount = String(escrowRow.amount_minor);
  const result = await ledgerService._internal.postJournalOnClient(client, {
    reason,
    referenceType: 'escrow_hold',
    referenceId: escrowRow.id,
    operatingDate: todayUtc(),
    entries: [
      { accountCode: fromAccountCode, side: 'DR', amount, currency },
      { accountCode: toAccountCode,   side: 'CR', amount, currency }
    ],
    metadata: { escrowNumber: escrowRow.escrow_number, action }
  });
  return result.journalId;
};

const ensureAccounts = async (client, { payerParticipant, payeeParticipant, currency }) => {
  await ledgerService._internal.ensureAccountOnClient(client, {
    accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
    ownerId: payerParticipant,
    currency
  });
  await ledgerService._internal.ensureAccountOnClient(client, {
    accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
    ownerId: payeeParticipant,
    currency
  });
  await ledgerService._internal.ensureAccountOnClient(client, {
    accountType: ACCOUNT_TYPES.RAIL_ESCROW,
    currency
  });
};

export const createEscrowService = ({ db, model }) => {
  const create = async ({
    payerParticipant, payerAccountNumber, payerName,
    payeeParticipant, payeeAccountNumber,
    amountMinor, currency,
    releaseCondition, releaseAt, arbiterUserId, reason
  }) => {
    const payerAccount = await directoryService.findByAccount({ participantCode: payerParticipant, accountNumber: payerAccountNumber });
    if (!payerAccount) throw new AppError('NOT_FOUND', `payer account not found`, 404);
    const payeeAccount = await directoryService.findByAccount({ participantCode: payeeParticipant, accountNumber: payeeAccountNumber });
    if (!payeeAccount) throw new AppError('NOT_FOUND', `payee account not found`, 404);
    if (releaseCondition === 'TIME_ELAPSED' && !releaseAt) {
      throw new AppError('VALIDATION_FAILED', 'TIME_ELAPSED requires releaseAt', 400);
    }
    if (releaseCondition === 'ARBITER_RELEASE' && !arbiterUserId) {
      throw new AppError('VALIDATION_FAILED', 'ARBITER_RELEASE requires arbiterUserId', 400);
    }

    return db.withTransaction(async (client) => {
      const bucket = monthBucket();
      const seq = await model.bumpSequence(client, bucket);
      const id = uuidv7();
      const escrowNumber = formatNumber(bucket, seq);
      const inserted = await model.insert(client, {
        id,
        escrowNumber,
        payerParticipant,
        payerAccountId: payerAccount.id,
        payeeParticipant,
        payeeAccountId: payeeAccount.id,
        amountMinor,
        currency,
        releaseCondition,
        releaseAt,
        arbiterUserId,
        reason
      });

      // Post the hold journal: DR payer settlement, CR RAIL_ESCROW.
      await ensureAccounts(client, { payerParticipant, payeeParticipant, currency });
      const fromCode = accountCodeFor({ accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT, ownerId: payerParticipant, currency });
      const toCode = accountCodeFor({ accountType: ACCOUNT_TYPES.RAIL_ESCROW, currency });
      const journalId = await postJournal(client, {
        reason: JOURNAL_REASONS.ESCROW_HOLD,
        escrowRow: inserted,
        currency,
        fromAccountCode: fromCode,
        toAccountCode: toCode,
        action: OVERLAY_TYPE_HOLD
      });

      const updated = await model.setState(client, {
        id,
        toState: STATES.HELD,
        fields: { metadata: JSON.stringify({ holdJournalId: journalId, payerName }) }
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'escrow.held',
        resourceType: 'escrow_hold',
        resourceId: id,
        payload: { escrowNumber, holdJournalId: journalId, releaseCondition, amountMinor: String(amountMinor) }
      });
      return updated;
    });
  };

  const findByNumber = (n) => db.withClient((c) => model.findByNumber(c, n));
  const findById = (id) => db.withClient((c) => model.findById(c, id));
  const list = (filters) => db.withClient((c) => model.list(c, filters));

  // Sign — used for BOTH_SIGNATURES condition. Returns the latest case row.
  // Auto-releases when both have signed.
  const sign = async ({ escrowNumber, signedBy, signedByUser }) =>
    db.withTransaction(async (client) => {
      const e = await model.findByNumber(client, escrowNumber);
      if (!e) throw new AppError('NOT_FOUND', `escrow ${escrowNumber} not found`, 404);
      if (e.state !== STATES.HELD) {
        throw new AppError('CONFLICT', `sign requires HELD; got ${e.state}`, 409);
      }
      if (e.release_condition !== 'BOTH_SIGNATURES') {
        throw new AppError('CONFLICT', `sign only valid for BOTH_SIGNATURES, got ${e.release_condition}`, 409);
      }
      const fields = {};
      if (signedBy === 'PAYER') fields.payer_signed_at = new Date().toISOString();
      else if (signedBy === 'PAYEE') fields.payee_signed_at = new Date().toISOString();
      else throw new AppError('VALIDATION_FAILED', `unknown signedBy ${signedBy}`, 400);
      const updated = await model.setState(client, { id: e.id, toState: STATES.HELD, fields });
      await auditService.record(client, {
        actorType: signedByUser ? 'user' : 'system',
        actorId: signedByUser || null,
        eventType: 'escrow.signed',
        resourceType: 'escrow_hold',
        resourceId: e.id,
        payload: { signedBy }
      });
      // If both signed, release.
      if (updated.payer_signed_at && updated.payee_signed_at) {
        return releaseInternal(client, updated, { byActor: 'BOTH_SIGNATURES' });
      }
      return updated;
    });

  // Internal: post the release journal + transition to RELEASED.
  const releaseInternal = async (client, e, { byActor }) => {
    if (!canTransition(e.state, STATES.RELEASED)) {
      throw new AppError('CONFLICT', `release requires HELD; got ${e.state}`, 409);
    }
    const fromCode = accountCodeFor({ accountType: ACCOUNT_TYPES.RAIL_ESCROW, currency: e.currency });
    const toCode = accountCodeFor({
      accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
      ownerId: e.payee_participant,
      currency: e.currency
    });
    const journalId = await postJournal(client, {
      reason: JOURNAL_REASONS.ESCROW_RELEASE,
      escrowRow: e,
      currency: e.currency,
      fromAccountCode: fromCode,
      toAccountCode: toCode,
      action: OVERLAY_TYPE_RELEASE
    });
    const meta = { ...(e.metadata || {}), releaseJournalId: journalId, releasedBy: byActor };
    const updated = await model.setState(client, {
      id: e.id,
      toState: STATES.RELEASED,
      fields: { released_at: new Date().toISOString(), metadata: JSON.stringify(meta) }
    });
    await auditService.record(client, {
      actorType: 'system',
      eventType: 'escrow.released',
      resourceType: 'escrow_hold',
      resourceId: e.id,
      payload: { escrowNumber: e.escrow_number, byActor, releaseJournalId: journalId }
    });
    return updated;
  };

  // Refund — return funds to payer. Mirrors release with payer as destination.
  const refundInternal = async (client, e, { reason, byActor }) => {
    if (!canTransition(e.state, STATES.REFUNDED)) {
      throw new AppError('CONFLICT', `refund requires HELD; got ${e.state}`, 409);
    }
    const fromCode = accountCodeFor({ accountType: ACCOUNT_TYPES.RAIL_ESCROW, currency: e.currency });
    const toCode = accountCodeFor({
      accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
      ownerId: e.payer_participant,
      currency: e.currency
    });
    const journalId = await postJournal(client, {
      reason: JOURNAL_REASONS.ESCROW_RELEASE,
      escrowRow: e,
      currency: e.currency,
      fromAccountCode: fromCode,
      toAccountCode: toCode,
      action: 'ESCROW_REFUND'
    });
    const meta = { ...(e.metadata || {}), refundJournalId: journalId, refundedBy: byActor };
    const updated = await model.setState(client, {
      id: e.id,
      toState: STATES.REFUNDED,
      fields: {
        refunded_at: new Date().toISOString(),
        reason: reason ?? e.reason,
        metadata: JSON.stringify(meta)
      }
    });
    await auditService.record(client, {
      actorType: 'system',
      eventType: 'escrow.refunded',
      resourceType: 'escrow_hold',
      resourceId: e.id,
      payload: { escrowNumber: e.escrow_number, byActor, reason }
    });
    return updated;
  };

  // PAYER_RELEASE — payer alone can call.
  const payerRelease = async ({ escrowNumber, releasedByUser }) =>
    db.withTransaction(async (client) => {
      const e = await model.findByNumber(client, escrowNumber);
      if (!e) throw new AppError('NOT_FOUND', `escrow ${escrowNumber} not found`, 404);
      if (e.release_condition !== 'PAYER_RELEASE') {
        throw new AppError('CONFLICT', `payer-release only valid for PAYER_RELEASE, got ${e.release_condition}`, 409);
      }
      void releasedByUser;
      return releaseInternal(client, e, { byActor: 'PAYER_RELEASE' });
    });

  // ARBITER_RELEASE — only the designated arbiter can call.
  const arbiterRelease = async ({ escrowNumber, arbiterUserId, reason }) =>
    db.withTransaction(async (client) => {
      const e = await model.findByNumber(client, escrowNumber);
      if (!e) throw new AppError('NOT_FOUND', `escrow ${escrowNumber} not found`, 404);
      if (e.release_condition !== 'ARBITER_RELEASE') {
        throw new AppError('CONFLICT', `arbiter-release only valid for ARBITER_RELEASE, got ${e.release_condition}`, 409);
      }
      if (e.arbiter_user_id !== arbiterUserId) {
        throw new AppError('CONFLICT', 'caller is not the designated arbiter', 403);
      }
      void reason;
      return releaseInternal(client, e, { byActor: 'ARBITER_RELEASE' });
    });

  // Refund / cancel: payer initiates while still HELD.
  const refund = async ({ escrowNumber, reason }) =>
    db.withTransaction(async (client) => {
      const e = await model.findByNumber(client, escrowNumber);
      if (!e) throw new AppError('NOT_FOUND', `escrow ${escrowNumber} not found`, 404);
      return refundInternal(client, e, { reason, byActor: 'PAYER_REFUND' });
    });

  const cancel = async ({ escrowNumber, reason }) =>
    db.withTransaction(async (client) => {
      const e = await model.findByNumber(client, escrowNumber);
      if (!e) throw new AppError('NOT_FOUND', `escrow ${escrowNumber} not found`, 404);
      if (isTerminal(e.state)) {
        throw new AppError('CONFLICT', `escrow ${escrowNumber} is in terminal state ${e.state}`, 409);
      }
      // INITIATED → CANCELLED: no money has moved yet.
      if (e.state === STATES.INITIATED) {
        const updated = await model.setState(client, {
          id: e.id,
          toState: STATES.CANCELLED,
          fields: { reason: reason ?? null }
        });
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'escrow.cancelled',
          resourceType: 'escrow_hold',
          resourceId: e.id,
          payload: { reason }
        });
        return updated;
      }
      // HELD → REFUNDED (cancellation requires returning funds).
      return refundInternal(client, e, { reason, byActor: 'CANCEL' });
    });

  // Worker tick: pick TIME_ELAPSED escrows whose deadlines hit, auto-release.
  const tick = async () => {
    const due = await db.withTransaction((c) => model.pickDueTimeElapsed(c, 100));
    const results = [];
    for (const e of due) {
      try {
        const r = await db.withTransaction((c) => releaseInternal(c, e, { byActor: 'TIME_ELAPSED' }));
        results.push({ id: e.id, ok: true, state: r.state });
      } catch (err) {
        results.push({ id: e.id, ok: false, error: err?.message || String(err) });
      }
    }
    return { picked: due.length, results };
  };

  return { create, sign, payerRelease, arbiterRelease, refund, cancel, findByNumber, findById, list, tick };
};
