import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import * as db from '../../core/db.js';
import { auditService } from '../audit/index.js';
import { directoryService } from '../directory/index.js';
import { createEnvelope } from '../envelope/index.js';
import { transactionsOrchestrator } from '../transactions/index.js';
import { DEBIT_RESULTS, OVERLAY_TYPE_DEBIT } from './codes.js';
import { STATES, isTerminal } from './states.js';

const monthBucket = (d = new Date()) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

const formatNumber = (bucket, seq) => `MND-${bucket}-${String(seq).padStart(6, '0')}`;

const advanceNextScheduled = (frequency, from = new Date()) => {
  const d = from instanceof Date ? new Date(from.getTime()) : new Date(from);
  switch (frequency) {
    case 'DAILY':   d.setUTCDate(d.getUTCDate() + 1); break;
    case 'WEEKLY':  d.setUTCDate(d.getUTCDate() + 7); break;
    case 'MONTHLY': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'AS_PRESENTED': return null;
    default: throw new Error(`unknown frequency ${frequency}`);
  }
  return d.toISOString();
};

const startOfDayUtcMs = (d = new Date()) =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);

const startOfMonthUtcIso = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();

// Counter durability for debit attempt records: insert in a separate
// connection so a CAP_BREACH on a busy mandate is durably logged even if
// the caller's surrounding context rolls back.
const recordDebitOnSeparateConnection = (model, payload) =>
  db.withClient((c) => model.insertDebit(c, payload));

export const createMandatesService = ({ db: dbm, model }) => {
  const create = async (input) => {
    const {
      payerParticipant, payerAccountNumber,
      payeeParticipant, payeeAccountNumber,
      perDebitCapMinor, dailyCapMinor, monthlyCapMinor, totalCapMinor,
      currency, frequency, reference, description, effectiveFrom, effectiveTo
    } = input;

    const payerAccount = await directoryService.findByAccount({ participantCode: payerParticipant, accountNumber: payerAccountNumber });
    if (!payerAccount) throw new AppError('NOT_FOUND', `payer account not found`, 404);
    const payeeAccount = await directoryService.findByAccount({ participantCode: payeeParticipant, accountNumber: payeeAccountNumber });
    if (!payeeAccount) throw new AppError('NOT_FOUND', `payee account not found`, 404);

    const eff = effectiveFrom ? new Date(effectiveFrom) : new Date();
    const next = frequency === 'AS_PRESENTED' ? null : advanceNextScheduled(frequency, eff);

    return dbm.withTransaction(async (client) => {
      const bucket = monthBucket();
      const seq = await model.bumpSequence(client, bucket);
      const id = uuidv7();
      const inserted = await model.insert(client, {
        id,
        mandateNumber: formatNumber(bucket, seq),
        payerParticipant,
        payerAccountId: payerAccount.id,
        payeeParticipant,
        payeeAccountId: payeeAccount.id,
        perDebitCapMinor,
        dailyCapMinor,
        monthlyCapMinor,
        totalCapMinor,
        currency,
        frequency,
        reference,
        description,
        effectiveFrom: eff.toISOString(),
        effectiveTo,
        nextScheduledAt: next
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'mandate.created',
        resourceType: 'mandate',
        resourceId: id,
        payload: {
          mandateNumber: inserted.mandate_number,
          payerParticipant,
          payeeParticipant,
          frequency,
          perDebitCapMinor: String(perDebitCapMinor)
        }
      });
      return inserted;
    });
  };

  const findByNumber = (n) => dbm.withClient((c) => model.findByNumber(c, n));
  const findById = (id) => dbm.withClient((c) => model.findById(c, id));
  const list = (filters) => dbm.withClient((c) => model.list(c, filters));
  const listDebits = (id, limit) => dbm.withClient((c) => model.listDebits(c, id, limit));

  // Cap algorithm. Returns null if all caps OK; otherwise returns { result, message }.
  const checkCaps = async (client, mandate, presented) => {
    const presentedBig = BigInt(presented);
    if (presentedBig > BigInt(mandate.per_debit_cap_minor)) {
      return { result: DEBIT_RESULTS.CAP_BREACH, message: `presented ${presentedBig} > per-debit cap ${mandate.per_debit_cap_minor}` };
    }
    if (mandate.daily_cap_minor) {
      const sumDaily = BigInt(
        await model.sumSuccessfulDebitsSince(client, {
          mandateId: mandate.id,
          since: new Date(startOfDayUtcMs()).toISOString()
        })
      );
      if (sumDaily + presentedBig > BigInt(mandate.daily_cap_minor)) {
        return { result: DEBIT_RESULTS.CAP_BREACH, message: `daily ${sumDaily + presentedBig} > daily cap ${mandate.daily_cap_minor}` };
      }
    }
    if (mandate.monthly_cap_minor) {
      const sumMonthly = BigInt(
        await model.sumSuccessfulDebitsSince(client, {
          mandateId: mandate.id,
          since: startOfMonthUtcIso()
        })
      );
      if (sumMonthly + presentedBig > BigInt(mandate.monthly_cap_minor)) {
        return { result: DEBIT_RESULTS.CAP_BREACH, message: `monthly ${sumMonthly + presentedBig} > monthly cap ${mandate.monthly_cap_minor}` };
      }
    }
    if (mandate.total_cap_minor) {
      const total = BigInt(mandate.total_debited_minor) + presentedBig;
      if (total > BigInt(mandate.total_cap_minor)) {
        return { result: DEBIT_RESULTS.CAP_BREACH, message: `total ${total} > total cap ${mandate.total_cap_minor}` };
      }
    }
    return null;
  };

  // Present a debit. The mandate row is row-locked here (the caller may pass
  // an existing client+row, but the public form opens its own withTransaction
  // for atomicity). If caps OK, builds CRDT_TRF and calls orchestrator OUTSIDE
  // the surrounding tx (the orchestrator owns its own tx). On confirmed,
  // applies debit totals and advances next_scheduled_at.
  const presentDebit = async ({ mandateId, presentedAmountMinor, presentedByActor = 'system' }) => {
    // 1. Read mandate state + run cap checks (single short transaction).
    const preCheck = await dbm.withTransaction(async (client) => {
      const m = await model.findById(client, mandateId);
      if (!m) throw new AppError('NOT_FOUND', `mandate ${mandateId} not found`, 404);
      if (isTerminal(m.state)) {
        return { ok: false, mandate: m, reason: { result: DEBIT_RESULTS.OTHER, message: `mandate is ${m.state}` } };
      }
      if (m.state === STATES.PAUSED) {
        return { ok: false, mandate: m, reason: { result: DEBIT_RESULTS.PAUSED, message: 'mandate paused' } };
      }
      const capResult = await checkCaps(client, m, presentedAmountMinor);
      return { ok: !capResult, mandate: m, reason: capResult };
    });

    // 2. If cap-breach or terminal/paused, durably record the failure.
    if (!preCheck.ok) {
      await recordDebitOnSeparateConnection(model, {
        id: uuidv7(),
        mandateId,
        transactionId: null,
        presentedAmountMinor,
        result: preCheck.reason.result,
        resultMessage: preCheck.reason.message
      });
      await dbm.withTransaction((c) =>
        auditService.record(c, {
          actorType: 'system',
          eventType: 'mandate.debit_failed',
          resourceType: 'mandate',
          resourceId: mandateId,
          payload: { result: preCheck.reason.result, presentedAmountMinor: String(presentedAmountMinor) }
        })
      );
      return { ok: false, ...preCheck };
    }

    const m = preCheck.mandate;
    const payerAccount = await directoryService.findById(m.payer_account_id);
    const payeeAccount = await directoryService.findById(m.payee_account_id);
    if (!payerAccount || !payeeAccount) {
      throw new AppError('NOT_FOUND', 'mandate party account missing', 404);
    }

    // 3. Run the orchestrator (its own transaction).
    const envelope = createEnvelope({
      msgType: 'CRDT_TRF',
      sourceFormat: 'REST',
      sourceMessageId: `mnd-${m.id}-${Date.now()}`,
      endToEndId: `mnd-${m.id}-${Date.now()}`,
      idempotencyKey: `mnd-debit-${m.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      originator: {
        participantCode: m.payer_participant,
        accountId: payerAccount.account_number,
        accountType: payerAccount.account_type,
        name: payerAccount.account_name,
        countryCode: 'GH'
      },
      beneficiary: {
        participantCode: m.payee_participant,
        accountId: payeeAccount.account_number,
        accountType: payeeAccount.account_type,
        name: payeeAccount.account_name,
        countryCode: 'GH'
      },
      amount: { value: String(presentedAmountMinor), currency: m.currency },
      reference: m.reference || `Mandate ${m.mandate_number}`,
      purposeCode: 'GDDS',
      settlementMethod: 'CLRG',
      metadata: {
        overlay: { type: OVERLAY_TYPE_DEBIT, overlayId: m.id, mandateNumber: m.mandate_number, presentedByActor }
      }
    });

    const orchResult = await transactionsOrchestrator.process(envelope);
    const tx = orchResult.transaction;
    const success = tx.state === 'CONFIRMED';
    const result = success ? DEBIT_RESULTS.SUCCESS : DEBIT_RESULTS.OTHER;

    // 4. Bookkeeping in our own tx.
    return dbm.withTransaction(async (client) => {
      await model.insertDebit(client, {
        id: uuidv7(),
        mandateId,
        transactionId: tx.id,
        presentedAmountMinor,
        result,
        resultMessage: success ? null : `tx state=${tx.state} reason=${tx.reason_code}`
      });
      let updated = m;
      if (success) {
        updated = await model.applyDebitTotals(client, { mandateId, presentedAmountMinor });
        // Advance next_scheduled_at for time-based mandates.
        if (m.frequency !== 'AS_PRESENTED') {
          updated = await model.setState(client, {
            id: mandateId,
            toState: updated.state,
            fields: { next_scheduled_at: advanceNextScheduled(m.frequency) }
          });
        }
        // Total cap exhaustion check.
        if (m.total_cap_minor && BigInt(updated.total_debited_minor) >= BigInt(m.total_cap_minor)) {
          updated = await model.setState(client, {
            id: mandateId,
            toState: STATES.EXHAUSTED,
            fields: { next_scheduled_at: null }
          });
          await auditService.record(client, {
            actorType: 'system',
            eventType: 'mandate.exhausted',
            resourceType: 'mandate',
            resourceId: mandateId,
            payload: { totalDebited: String(updated.total_debited_minor) }
          });
        }
      }
      await auditService.record(client, {
        actorType: 'system',
        eventType: success ? 'mandate.debit_succeeded' : 'mandate.debit_failed',
        resourceType: 'mandate',
        resourceId: mandateId,
        payload: { transactionId: tx.id, txState: tx.state, presentedAmountMinor: String(presentedAmountMinor) }
      });
      return { ok: success, mandate: updated, transaction: tx, result };
    });
  };

  const revoke = async ({ mandateNumber, revokedBy, reason }) =>
    dbm.withTransaction(async (client) => {
      const m = await model.findByNumber(client, mandateNumber);
      if (!m) throw new AppError('NOT_FOUND', `mandate ${mandateNumber} not found`, 404);
      if (isTerminal(m.state)) {
        throw new AppError('CONFLICT', `mandate ${mandateNumber} is in terminal state ${m.state}`, 409);
      }
      const updated = await model.setState(client, {
        id: m.id,
        toState: STATES.REVOKED,
        fields: { revoked_at: new Date().toISOString(), revoked_by: revokedBy, next_scheduled_at: null }
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'mandate.revoked',
        resourceType: 'mandate',
        resourceId: m.id,
        payload: { mandateNumber, revokedBy, reason }
      });
      return updated;
    });

  const pause = async ({ mandateNumber, reason }) =>
    dbm.withTransaction(async (client) => {
      const m = await model.findByNumber(client, mandateNumber);
      if (!m) throw new AppError('NOT_FOUND', `mandate ${mandateNumber} not found`, 404);
      if (m.state !== STATES.ACTIVE) {
        throw new AppError('CONFLICT', `pause requires ACTIVE; got ${m.state}`, 409);
      }
      const updated = await model.setState(client, { id: m.id, toState: STATES.PAUSED });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'mandate.paused',
        resourceType: 'mandate',
        resourceId: m.id,
        payload: { mandateNumber, reason }
      });
      return updated;
    });

  const resume = async ({ mandateNumber }) =>
    dbm.withTransaction(async (client) => {
      const m = await model.findByNumber(client, mandateNumber);
      if (!m) throw new AppError('NOT_FOUND', `mandate ${mandateNumber} not found`, 404);
      if (m.state !== STATES.PAUSED) {
        throw new AppError('CONFLICT', `resume requires PAUSED; got ${m.state}`, 409);
      }
      const updated = await model.setState(client, { id: m.id, toState: STATES.ACTIVE });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'mandate.resumed',
        resourceType: 'mandate',
        resourceId: m.id,
        payload: { mandateNumber }
      });
      return updated;
    });

  // Scheduler tick: pick due mandates, present default debit (= per_debit_cap or
  // a configurable amount stored in metadata.scheduledAmountMinor, defaulting to per_debit_cap).
  const tick = async () => {
    const due = await dbm.withTransaction((client) => model.pickDue(client, 100));
    const results = [];
    for (const m of due) {
      const presented = m.metadata?.scheduledAmountMinor || m.per_debit_cap_minor;
      try {
        const r = await presentDebit({
          mandateId: m.id,
          presentedAmountMinor: String(presented),
          presentedByActor: 'scheduler'
        });
        results.push({ mandateId: m.id, ok: r.ok, result: r.result });
      } catch (e) {
        results.push({ mandateId: m.id, ok: false, error: e?.message || String(e) });
      }
    }
    return { processed: due.length, results };
  };

  return { create, findById, findByNumber, list, listDebits, presentDebit, revoke, pause, resume, tick };
};
