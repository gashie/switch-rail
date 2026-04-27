import { AppError } from '../../core/errors.js';
import { canonicalJsonBytes } from '../../core/json.js';
import { uuidv7 } from '../../core/uuid.js';
import { config } from '../../core/config.js';
import { cryptoKeysService } from '../crypto-keys/index.js';
import { participantsService } from '../participants/index.js';
import { transactionsService } from '../transactions/index.js';
import { transactionReceiptsService } from '../transaction-receipts/index.js';
import { ledgerService, ACCOUNT_TYPES, JOURNAL_REASONS, accountCodeFor } from '../ledger/index.js';
import { auditService } from '../audit/index.js';
import { withTimeout } from '../credit-leg/index.js';
import { byName as railClassByName } from '../rail-orchestration/index.js';
import { getPolicy, nextDelayMs, isExhausted } from './policy.js';

/**
 * Possible outcomes of a single status-check probe. The recovery service
 * records one of these into status-history payload per attempt and then
 * uses the bag of past outcomes to decide what terminal state to land in
 * once the policy says we're out of attempts.
 */
export const PROBE_OUTCOMES = Object.freeze({
  CREDITED: 'CREDITED',
  NOT_CREDITED: 'NOT_CREDITED',
  PENDING: 'PENDING',
  NOT_FOUND: 'NOT_FOUND',
  ERROR: 'ERROR'
});

const TEST_DELAY_DIVISOR = 100; // 2s real → 20ms in test mode

const computeNextAttemptAt = (policy, attemptsAlready) => {
  const baseMs = nextDelayMs(policy, attemptsAlready);
  const ms = config.txTestMode ? Math.max(5, Math.floor(baseMs / TEST_DELAY_DIVISOR)) : baseMs;
  return new Date(Date.now() + ms);
};

const railTimeoutMs = (railClassName) => {
  if (config.txTestMode) return 1500;
  const cls = railClassName ? railClassByName(railClassName) : null;
  return cls?.timeoutMs ?? 10_000;
};

const findRailKid = async () => {
  const keys = await cryptoKeysService.listActive({ ownerType: 'rail', ownerId: null });
  if (keys.length === 0) {
    throw new AppError(
      'CONFLICT',
      'no active rail signing key — recovery cannot sign status-check',
      503
    );
  }
  return keys[0].kid;
};

const buildSignedStatusCheck = async ({ transaction }) => {
  const payload = {
    transactionId: transaction.id,
    endToEndId: transaction.end_to_end_id,
    beneficiary: {
      participantCode: transaction.beneficiary_participant,
      accountId: transaction.beneficiary_account
    }
  };
  const bytes = canonicalJsonBytes(payload);
  const railKid = await findRailKid();
  const signature = await cryptoKeysService.sign({ kid: railKid, payload: bytes });
  return { payload, bytes, signature };
};

const interpretStatusCheck = (httpJson) => {
  if (!httpJson || typeof httpJson !== 'object' || httpJson.ok !== true) {
    return { outcome: PROBE_OUTCOMES.ERROR, raw: httpJson };
  }
  const data = httpJson.data || {};
  if (data.found === false) {
    return { outcome: PROBE_OUTCOMES.NOT_FOUND, raw: httpJson };
  }
  if (data.status === 'credited') {
    return { outcome: PROBE_OUTCOMES.CREDITED, creditedAt: data.creditedAt, raw: httpJson };
  }
  if (data.status === 'not_credited') {
    return { outcome: PROBE_OUTCOMES.NOT_CREDITED, raw: httpJson };
  }
  if (data.status === 'pending') {
    return { outcome: PROBE_OUTCOMES.PENDING, raw: httpJson };
  }
  return { outcome: PROBE_OUTCOMES.ERROR, raw: httpJson };
};

const runStatusCheck = async ({ transaction, url, timeoutMs }) => {
  const t0 = Date.now();
  const { bytes, signature } = await buildSignedStatusCheck({ transaction });
  const requestId = uuidv7();
  const controller = new AbortController();
  const fetchPromise = (async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sika-signature': signature.signature,
        'x-sika-kid': signature.kid,
        'x-sika-request-id': requestId
      },
      body: bytes,
      signal: controller.signal
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: { code: 'XT99', message: `non-JSON: ${text.slice(0, 80)}` } };
    }
  })();
  try {
    const httpJson = await withTimeout(fetchPromise, timeoutMs, () => {
      controller.abort();
      const err = new Error('status-check deadline exceeded');
      err._sika_kind = 'TIMEOUT';
      return err;
    });
    const elapsed = Date.now() - t0;
    return { ...interpretStatusCheck(httpJson), durationMs: elapsed, requestId };
  } catch (e) {
    const elapsed = Date.now() - t0;
    return {
      outcome: PROBE_OUTCOMES.ERROR,
      raw: { error: e?.message || String(e), kind: e?._sika_kind || 'network' },
      durationMs: elapsed,
      requestId
    };
  }
};

const decideTerminalAtExhaust = (probeOutcomes) => {
  if (probeOutcomes.includes(PROBE_OUTCOMES.CREDITED)) {
    return { state: 'CONFIRMED', reasonCode: 'SUCCESS', responseCode: 'ACSC' };
  }
  if (probeOutcomes.includes(PROBE_OUTCOMES.NOT_CREDITED)) {
    return {
      state: 'REJECTED',
      reasonCode: 'BENEFICIARY_NOT_CREDITED',
      responseCode: 'RJCT'
    };
  }
  if (probeOutcomes.includes(PROBE_OUTCOMES.PENDING)) {
    return {
      state: 'REJECTED',
      reasonCode: 'TIMEOUT',
      responseCode: 'RJCT'
    };
  }
  // Everything was not_found or error → credit may have been applied with
  // no record. Move to FAILED so the reversal service (B4.10) can unwind.
  return {
    state: 'FAILED',
    reasonCode: 'RECONCILIATION_EXHAUSTED',
    responseCode: 'RJCT',
    triggerReversal: true
  };
};

export const createTransactionRecoveryService = ({
  db,
  model,
  triggerReversal = null // (client, transaction, { reason }) => Promise<void>
}) => {
  const probeOnce = async ({ transaction }) => {
    const beneficiary = await participantsService
      .getByCode(transaction.beneficiary_participant)
      .catch(() => null);
    const url = beneficiary?.endpoints?.status_check;
    if (!url) {
      return {
        outcome: PROBE_OUTCOMES.ERROR,
        raw: { reason: 'beneficiary participant has no status_check endpoint registered' },
        durationMs: 0
      };
    }
    return runStatusCheck({
      transaction,
      url,
      timeoutMs: railTimeoutMs(transaction.rail_class)
    });
  };

  const runOnceForId = async (id) => {
    // 1. Probe the participant OUTSIDE any DB txn — HTTP shouldn't hold a
    // pg connection. Probe outcome is fed to the deciding txn below.
    const snapshot = await db.withClient((c) => model.findRecoveryRow(c, id));
    if (!snapshot) {
      throw new AppError('NOT_FOUND', `transaction ${id} not found`, 404);
    }
    if (snapshot.state !== 'PENDING_RECONCILIATION') {
      // Already terminal / moved on — nothing to do.
      return { id, skipped: true, reason: `state=${snapshot.state}` };
    }

    const probe = await probeOnce({ transaction: snapshot });
    const policy = getPolicy(snapshot.retry_policy_name || 'aggressive');

    // 2. Counter durability — bump attempts on a SEPARATE connection so the
    //    increment survives even if the deciding transaction below rolls
    //    back.
    const counter = await model.bumpAttemptsOnSeparateConnection(db, {
      id,
      nextAttemptAt: null, // we'll set the schedule inside the deciding txn
      retryPolicyName: snapshot.retry_policy_name || policy.name
    });
    const attemptsAfter = counter?.attempts ?? snapshot.attempts + 1;

    // 3. Decide and persist transition (or schedule next) atomically.
    return db.withTransaction(async (client) => {
      // Re-read inside the txn with FOR UPDATE so concurrent workers can't
      // both drive the same transaction terminal.
      const locked = await model.lockForRecovery(client, id);
      if (!locked) {
        throw new AppError('NOT_FOUND', `transaction ${id} disappeared`, 404);
      }
      if (locked.state !== 'PENDING_RECONCILIATION') {
        return { id, skipped: true, reason: `state=${locked.state}`, probe };
      }

      // Always write a recovery-worker history entry so the bag of probe
      // outcomes is auditable.
      await model.insertRecoveryHistory(client, {
        id: uuidv7(),
        transactionId: id,
        payload: {
          attempt: attemptsAfter,
          outcome: probe.outcome,
          durationMs: probe.durationMs ?? 0,
          requestId: probe.requestId,
          raw: probe.raw
        }
      });

      // Immediate terminal decisions (don't wait for exhaust).
      if (probe.outcome === PROBE_OUTCOMES.CREDITED) {
        const tx = await transactionsService._internal.transitionOnClient(
          client,
          id,
          'CONFIRMED',
          {
            responseCode: 'ACSC',
            reasonCode: 'SUCCESS',
            occurredBy: 'recovery-worker',
            payload: { recovery: true, attempts: attemptsAfter, creditedAt: probe.creditedAt }
          }
        );
        // Recovery-driven CONFIRMED follows the same locked order as the
        // orchestrator: state → ledger → receipts, all in this client's
        // transaction.
        const currency = tx.amount_currency;
        await ledgerService._internal.ensureAccountOnClient(client, {
          accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
          ownerId: tx.originator_participant,
          currency
        });
        await ledgerService._internal.ensureAccountOnClient(client, {
          accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
          ownerId: tx.beneficiary_participant,
          currency
        });
        const operatingDate = (tx.authorized_at || tx.created_at || new Date()).toISOString
          ? (tx.authorized_at || tx.created_at).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        const ledger = await ledgerService.postJournal(client, {
          reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
          referenceType: 'transaction',
          referenceId: tx.id,
          operatingDate,
          entries: [
            {
              accountCode: accountCodeFor({
                accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
                ownerId: tx.originator_participant,
                currency
              }),
              side: 'DR',
              amount: String(tx.amount_value),
              currency
            },
            {
              accountCode: accountCodeFor({
                accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
                ownerId: tx.beneficiary_participant,
                currency
              }),
              side: 'CR',
              amount: String(tx.amount_value),
              currency
            }
          ],
          metadata: { recovery: true, endToEndId: tx.end_to_end_id }
        });
        const receipts = await transactionReceiptsService.issueReceipts(client, tx);
        return { id, terminal: 'CONFIRMED', attempts: attemptsAfter, transaction: tx, probe, ledger, receipts };
      }
      if (probe.outcome === PROBE_OUTCOMES.NOT_CREDITED) {
        const tx = await transactionsService._internal.transitionOnClient(
          client,
          id,
          'REJECTED',
          {
            responseCode: 'RJCT',
            reasonCode: 'BENEFICIARY_NOT_CREDITED',
            reasonMessage: 'beneficiary reported transaction was not credited',
            occurredBy: 'recovery-worker',
            payload: { recovery: true, attempts: attemptsAfter }
          }
        );
        return { id, terminal: 'REJECTED', attempts: attemptsAfter, transaction: tx, probe };
      }

      // Inconclusive (PENDING / NOT_FOUND / ERROR) — check exhaustion.
      if (isExhausted(policy, attemptsAfter)) {
        const history = await model.listRecoveryHistory(client, id);
        const outcomes = [
          ...history.map((h) => h.payload?.outcome).filter(Boolean),
          probe.outcome
        ];
        const decision = decideTerminalAtExhaust(outcomes);
        const tx = await transactionsService._internal.transitionOnClient(
          client,
          id,
          decision.state,
          {
            responseCode: decision.responseCode,
            reasonCode: decision.reasonCode,
            reasonMessage: `recovery exhausted after ${attemptsAfter} attempts; outcomes=${outcomes.join(',')}`,
            occurredBy: 'recovery-worker',
            payload: { recovery: true, attempts: attemptsAfter, outcomes }
          }
        );
        if (decision.triggerReversal) {
          await auditService.record(client, {
            actorType: 'system',
            eventType: 'transaction.reversal_needed',
            resourceType: 'transaction',
            resourceId: id,
            payload: {
              reason: 'RECON_FAILED',
              attempts: attemptsAfter,
              outcomes
            }
          });
          if (typeof triggerReversal === 'function') {
            await triggerReversal(client, tx, { reason: 'RECON_FAILED' });
          }
        }
        return {
          id,
          terminal: decision.state,
          attempts: attemptsAfter,
          transaction: tx,
          outcomes,
          probe,
          reversalQueued: !!decision.triggerReversal
        };
      }

      // Not yet exhausted — schedule the next attempt.
      const nextAt = computeNextAttemptAt(policy, attemptsAfter);
      await model.scheduleNextOnClient(client, {
        id,
        nextAttemptAt: nextAt.toISOString(),
        retryPolicyName: policy.name
      });
      return {
        id,
        terminal: null,
        attempts: attemptsAfter,
        nextAttemptAt: nextAt.toISOString(),
        probe
      };
    });
  };

  const runBatch = async ({ limit = 10 } = {}) => {
    // Pick up due IDs in a brief locking transaction, then process each one
    // independently. Holding the SKIP-LOCKED rows across the per-row work
    // would defeat the point of the index-backed worker pool.
    const dueIds = await db.withTransaction(async (client) => {
      const rows = await model.selectDueForUpdate(client, { limit });
      return rows.map((r) => r.id);
    });
    const results = [];
    for (const id of dueIds) {
      try {
        results.push(await runOnceForId(id));
      } catch (e) {
        results.push({ id, error: e?.message || String(e) });
      }
    }
    return results;
  };

  return {
    runOnceForId,
    runBatch,
    probeOnce
  };
};
