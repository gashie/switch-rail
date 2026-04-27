import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import * as db from '../../core/db.js';
import { auditService } from '../audit/index.js';
import { transactionsService } from '../transactions/index.js';
import {
  REASON_CODES,
  SLA_WINDOWS,
  FILING_RATE_LIMIT
} from './codes.js';
import { STATES, isTerminal, canTransition } from './states.js';
import { evidencePendingUntil } from './sla-clock.js';
import { hasRunnerFor, runnerFor } from './auto-resolver.js';

const operatingDateFor = (tx) => {
  const ts = tx.confirmed_at || tx.authorized_at || tx.created_at || new Date();
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toISOString().slice(0, 10);
};

// Counter durability — separate connection so the rate-limit increment
// commits even if the surrounding case-creation transaction rolls back.
// Pattern matches B3 OTP attempt counting.
const bumpFilingCounterOnSeparateConnection = (model, params) =>
  db.withClient((c) => model.countFilingsForCustomer(c, params));

const monthBucket = (d = new Date()) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

const formatCaseNumber = (bucket, seq) =>
  `DSP-${bucket}-${String(seq).padStart(6, '0')}`;

const ageInDays = (timestamp) => {
  if (!timestamp) return Infinity;
  const t = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  return Math.floor((Date.now() - t) / 86_400_000);
};

export const createDisputesService = ({ db: dbm, model, decisionModel, autoValidator, reserveHolder, autoResolverDeps }) => {
  // Internal: writes status-history row and updates case state in same client.
  // Exposed for B7.2+ that need to drive the state machine from inside other
  // transactions (auto-validator, settlement-service, etc.).
  const transition = async (client, caseId, toState, { reason, payload, occurredBy } = {}) => {
    const current = await model.findById(client, caseId);
    if (!current) throw new AppError('NOT_FOUND', `dispute ${caseId} not found`, 404);
    if (current.state === toState) return current;
    if (isTerminal(current.state) && current.state !== toState) {
      throw new AppError(
        'CONFLICT',
        `dispute ${caseId} is in terminal state ${current.state}; cannot transition to ${toState}`,
        409
      );
    }
    if (!canTransition(current.state, toState)) {
      throw new AppError(
        'CONFLICT',
        `dispute ${caseId} cannot transition ${current.state} -> ${toState}`,
        409
      );
    }
    const updated = await model.setState(client, {
      id: caseId,
      toState,
      fields: payload?.fields || null
    });
    await model.insertHistory(client, {
      id: uuidv7(),
      caseId,
      fromState: current.state,
      toState,
      reason: reason ?? null,
      payload: payload || {},
      occurredBy: occurredBy || 'system'
    });
    return updated;
  };

  const file = async ({
    transactionId,
    reasonCode,
    filingParticipant,
    filingUserRef,
    verificationFingerprint,
    evidence,
    amountOverride,
    filedByUser
  }) => {
    if (!Object.values(REASON_CODES).includes(reasonCode)) {
      throw new AppError('VALIDATION_FAILED', `unknown reasonCode ${reasonCode}`, 400);
    }
    const slaWindow = SLA_WINDOWS[reasonCode];
    if (!slaWindow) {
      throw new AppError('VALIDATION_FAILED', `no SLA configured for ${reasonCode}`, 400);
    }

    // Counter durability: count first, then file. Counting commits in its own
    // connection so the read is durable; the actual filing happens in the
    // case-creation transaction below.
    const filedCount = await bumpFilingCounterOnSeparateConnection(model, {
      filingParticipant,
      filingUserRef,
      windowHours: FILING_RATE_LIMIT.windowHours
    });
    if (filedCount >= FILING_RATE_LIMIT.maxPerCustomer) {
      // Persist the rate-limited filing as a terminal REJECTED case for audit
      // visibility (per the "auto-resolved cases also leave a trail" pattern).
      const caseId = uuidv7();
      const bucket = monthBucket();
      const seq = await dbm.withTransaction(async (client) => {
        const s = await model.bumpCaseSequence(client, bucket);
        await model.insertCase(client, {
          id: caseId,
          caseNumber: formatCaseNumber(bucket, s),
          transactionId,
          reasonCode,
          filingParticipant,
          filingUserRef,
          verificationFingerprint,
          amountMinor: '0',
          currency: 'XXX',
          state: STATES.REJECTED,
          metadata: { rejection: 'RATE_LIMITED', evidence: evidence || null }
        });
        await model.insertHistory(client, {
          id: uuidv7(),
          caseId,
          fromState: STATES.FILED,
          toState: STATES.REJECTED,
          reason: 'RATE_LIMITED',
          payload: { count: filedCount, windowHours: FILING_RATE_LIMIT.windowHours },
          occurredBy: filedByUser ? `user:${filedByUser}` : 'system'
        });
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'dispute.rate_limited',
          resourceType: 'dispute_case',
          resourceId: caseId,
          payload: { filingParticipant, filingUserRef, count: filedCount }
        });
        return s;
      });
      throw new AppError(
        'RATE_LIMITED',
        `filing rate limit reached: ${filedCount} disputes in last ${FILING_RATE_LIMIT.windowHours}h for ${filingParticipant}/${filingUserRef}`,
        429,
        { caseNumber: formatCaseNumber(bucket, seq) }
      );
    }

    // Validate transaction exists, is CONFIRMED, and within the filing window.
    const transaction = await transactionsService.findById(transactionId);
    if (!transaction) {
      throw new AppError('NOT_FOUND', `transaction ${transactionId} not found`, 404);
    }
    if (transaction.state !== 'CONFIRMED' && transaction.state !== 'REVERSED') {
      throw new AppError(
        'CONFLICT',
        `cannot dispute a transaction in state ${transaction.state}; only CONFIRMED or REVERSED`,
        409
      );
    }
    // Filing window check (REGULATORY has no window).
    if (slaWindow.fileWithinDays !== null) {
      const age = ageInDays(transaction.confirmed_at);
      if (age > slaWindow.fileWithinDays) {
        const caseId = uuidv7();
        const bucket = monthBucket();
        await dbm.withTransaction(async (client) => {
          const s = await model.bumpCaseSequence(client, bucket);
          await model.insertCase(client, {
            id: caseId,
            caseNumber: formatCaseNumber(bucket, s),
            transactionId,
            reasonCode,
            filingParticipant,
            filingUserRef,
            verificationFingerprint,
            amountMinor: String(transaction.amount_value),
            currency: transaction.amount_currency,
            state: STATES.REJECTED,
            metadata: { rejection: 'WINDOW_EXPIRED', ageDays: age, windowDays: slaWindow.fileWithinDays }
          });
          await model.insertHistory(client, {
            id: uuidv7(),
            caseId,
            fromState: STATES.FILED,
            toState: STATES.REJECTED,
            reason: 'WINDOW_EXPIRED',
            payload: { ageDays: age, windowDays: slaWindow.fileWithinDays },
            occurredBy: filedByUser ? `user:${filedByUser}` : 'system'
          });
          await auditService.record(client, {
            actorType: 'system',
            eventType: 'dispute.window_expired',
            resourceType: 'dispute_case',
            resourceId: caseId,
            payload: { transactionId, reasonCode, ageDays: age, windowDays: slaWindow.fileWithinDays }
          });
        });
        throw new AppError(
          'CONFLICT',
          `dispute filing window expired: original confirmed ${age} days ago, max ${slaWindow.fileWithinDays}`,
          409,
          { ageDays: age, windowDays: slaWindow.fileWithinDays }
        );
      }
    }

    return dbm.withTransaction(async (client) => {
      const bucket = monthBucket();
      const seq = await model.bumpCaseSequence(client, bucket);
      const caseNumber = formatCaseNumber(bucket, seq);
      const caseId = uuidv7();
      const amountMinor = amountOverride || String(transaction.amount_value);
      const inserted = await model.insertCase(client, {
        id: caseId,
        caseNumber,
        transactionId,
        reasonCode,
        filingParticipant,
        filingUserRef,
        verificationFingerprint,
        amountMinor,
        currency: transaction.amount_currency,
        state: STATES.FILED,
        metadata: {
          evidence: evidence || null,
          beneficiaryParticipant: transaction.beneficiary_participant,
          originatorParticipant: transaction.originator_participant
        }
      });
      await model.insertHistory(client, {
        id: uuidv7(),
        caseId,
        fromState: null,
        toState: STATES.FILED,
        reason: 'INITIAL_FILING',
        payload: { transactionId, reasonCode },
        occurredBy: filedByUser ? `user:${filedByUser}` : 'system'
      });
      await auditService.record(client, {
        actorType: filedByUser ? 'user' : 'system',
        actorId: filedByUser || null,
        eventType: 'dispute.filed',
        resourceType: 'dispute_case',
        resourceId: caseId,
        payload: { caseNumber, transactionId, reasonCode, filingParticipant }
      });
      return inserted;
    });
  };

  const findById = (id) => dbm.withClient((c) => model.findById(c, id));
  const findByCaseNumber = (caseNumber) =>
    dbm.withClient((c) => model.findByCaseNumber(c, caseNumber));
  const list = (filters) => dbm.withClient((c) => model.list(c, filters));
  const listForParticipant = (filingParticipant, filters) =>
    dbm.withClient((c) =>
      model.listForParticipant(c, { filingParticipant, ...filters })
    );
  const listForTransaction = (transactionId) =>
    dbm.withClient((c) => model.listForTransaction(c, transactionId));
  const listHistory = (caseId) => dbm.withClient((c) => model.listHistory(c, caseId));

  const operatorKill = async ({ id, reason, killedByUser }) => {
    return dbm.withTransaction(async (client) => {
      const current = await model.findById(client, id);
      if (!current) throw new AppError('NOT_FOUND', `dispute ${id} not found`, 404);
      if (isTerminal(current.state)) {
        throw new AppError(
          'CONFLICT',
          `dispute ${id} is already in terminal state ${current.state}`,
          409
        );
      }
      const updated = await model.setState(client, {
        id,
        toState: STATES.DENIED,
        fields: { resolved_at: new Date().toISOString(), outcome_notes: `KILL: ${reason}` }
      });
      await model.insertHistory(client, {
        id: uuidv7(),
        caseId: id,
        fromState: current.state,
        toState: STATES.DENIED,
        reason: 'OPERATOR_KILL_SWITCH',
        payload: { reason, killedByUser },
        occurredBy: killedByUser ? `user:${killedByUser}` : 'system'
      });
      await auditService.record(client, {
        actorType: 'user',
        actorId: killedByUser || null,
        eventType: 'dispute.terminated',
        resourceType: 'dispute_case',
        resourceId: id,
        payload: { reason, fromState: current.state }
      });
      return updated;
    });
  };

  // Drives a FILED case through validation -> ACCEPTED (with reserve hold) ->
  // either AUTO_RESOLVED (if a runner returns resolvable) or EVIDENCE_PENDING.
  // Idempotent: re-running on a non-FILED case is a no-op.
  const processFiled = async (caseId, { processedByUser } = {}) => {
    return dbm.withTransaction(async (client) => {
      const c = await model.findById(client, caseId);
      if (!c) throw new AppError('NOT_FOUND', `dispute ${caseId} not found`, 404);
      if (c.state !== STATES.FILED) {
        return { case: c, advanced: false };
      }
      if (!autoValidator || !reserveHolder) {
        throw new AppError(
          'CONFLICT',
          'service constructed without autoValidator or reserveHolder',
          500
        );
      }

      const valid = await autoValidator.validate(client, c);
      if (!valid.ok) {
        const updated = await model.setState(client, {
          id: caseId,
          toState: STATES.REJECTED,
          fields: {
            resolved_at: new Date().toISOString(),
            outcome_notes: `auto-validation: ${valid.reason}`
          }
        });
        await model.insertHistory(client, {
          id: uuidv7(),
          caseId,
          fromState: STATES.FILED,
          toState: STATES.REJECTED,
          reason: valid.code,
          payload: { reason: valid.reason },
          occurredBy: processedByUser ? `user:${processedByUser}` : 'system'
        });
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'dispute.rejected_filing',
          resourceType: 'dispute_case',
          resourceId: caseId,
          payload: { code: valid.code, reason: valid.reason }
        });
        return { case: updated, advanced: true, rejected: true };
      }

      const transaction = valid.transaction;
      const operatingDate = operatingDateFor(transaction);

      // Transition FILED -> ACCEPTED first so reserveHolder's signature
      // check (state === ACCEPTED) is satisfied. Same withTransaction.
      const accepted = await model.setState(client, {
        id: caseId,
        toState: STATES.ACCEPTED,
        fields: { accepted_at: new Date().toISOString() }
      });
      await model.insertHistory(client, {
        id: uuidv7(),
        caseId,
        fromState: STATES.FILED,
        toState: STATES.ACCEPTED,
        reason: 'AUTO_VALIDATED',
        payload: {},
        occurredBy: processedByUser ? `user:${processedByUser}` : 'system'
      });

      // Hold the reserve.
      const beneficiaryParticipant =
        transaction.beneficiary_participant ||
        accepted.metadata?.beneficiaryParticipant;
      const hold = await reserveHolder.holdAmount(client, {
        caseId,
        amountMinor: accepted.amount_minor,
        currency: accepted.currency,
        beneficiaryParticipant,
        operatingDate
      });
      const withReserve = await model.setState(client, {
        id: caseId,
        toState: STATES.ACCEPTED,
        fields: { reserve_journal_id: hold.journalId }
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'dispute.accepted',
        resourceType: 'dispute_case',
        resourceId: caseId,
        payload: {
          reserveJournalId: hold.journalId,
          beneficiaryParticipant,
          amountMinor: String(accepted.amount_minor)
        }
      });

      // Auto-resolve check. The runner registry is wired by routes.js with
      // the four real B7.4 runners; tests can register synthetic runners.
      const slaWindow = SLA_WINDOWS[withReserve.reason_code];
      const runnerKey = slaWindow.autoResolvable;
      if (runnerKey && hasRunnerFor(runnerKey)) {
        const runner = runnerFor(runnerKey);
        const resolved = await runner({
          caseRow: withReserve,
          transaction,
          client,
          deps: autoResolverDeps || {}
        });
        if (resolved.resolvable) {
          // Persist a dispute_decisions row with decision_type='AUTO'. This
          // mirrors the manual-decision path so settlement-service (B7.5)
          // sees a uniform decision regardless of how it was reached.
          if (decisionModel) {
            await decisionModel.insert(client, {
              id: uuidv7(),
              caseId,
              decisionType: 'AUTO',
              outcome: resolved.outcome,
              outcomeAmountMinor: resolved.outcomeAmountMinor || null,
              rationaleCode: resolved.rationaleCode,
              rationaleNotes: resolved.notes || null,
              decidedByUser: null,
              evidenceConsidered: { runnerKey, autoApplied: true }
            });
          }
          // Transition ACCEPTED -> AUTO_RESOLVED. The settlement-service
          // (B7.5) is responsible for the SETTLED transition + release
          // journal — the auto-resolver just records the outcome.
          const autoResolved = await model.setState(client, {
            id: caseId,
            toState: STATES.AUTO_RESOLVED,
            fields: {
              resolved_at: new Date().toISOString(),
              outcome: resolved.outcome,
              outcome_amount_minor: resolved.outcomeAmountMinor || null,
              outcome_notes: `auto-resolved by ${runnerKey}: ${resolved.rationaleCode}`
            }
          });
          await model.insertHistory(client, {
            id: uuidv7(),
            caseId,
            fromState: STATES.ACCEPTED,
            toState: STATES.AUTO_RESOLVED,
            reason: resolved.rationaleCode,
            payload: { outcome: resolved.outcome, runnerKey },
            occurredBy: 'system'
          });
          await auditService.record(client, {
            actorType: 'system',
            eventType: 'dispute.auto_resolved',
            resourceType: 'dispute_case',
            resourceId: caseId,
            payload: {
              runnerKey,
              outcome: resolved.outcome,
              rationaleCode: resolved.rationaleCode
            }
          });
          return { case: autoResolved, advanced: true, autoResolved: true, resolution: resolved };
        }
      }

      // No auto-resolution → EVIDENCE_PENDING with response window deadline.
      const deadline = evidencePendingUntil(withReserve.reason_code);
      const pending = await model.setState(client, {
        id: caseId,
        toState: STATES.EVIDENCE_PENDING,
        fields: { evidence_pending_until: deadline.toISOString() }
      });
      await model.insertHistory(client, {
        id: uuidv7(),
        caseId,
        fromState: STATES.ACCEPTED,
        toState: STATES.EVIDENCE_PENDING,
        reason: 'AWAITING_EVIDENCE',
        payload: { deadlineIso: deadline.toISOString() },
        occurredBy: 'system'
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'dispute.evidence_requested',
        resourceType: 'dispute_case',
        resourceId: caseId,
        payload: {
          beneficiaryParticipant,
          deadlineIso: deadline.toISOString(),
          // webhook delivery deferred to Phase 10; audit serves as the signal.
          delivery: 'audit-only'
        }
      });

      return { case: pending, advanced: true, autoResolved: false };
    });
  };

  return {
    file,
    processFiled,
    findById,
    findByCaseNumber,
    list,
    listForParticipant,
    listForTransaction,
    listHistory,
    transition,
    operatorKill
  };
};
