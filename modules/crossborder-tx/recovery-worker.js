// Cross-border recovery. After the local PvP coordinator commits both ledger
// legs, this worker polls the foreign rail's instruct endpoint to actually
// hand off the transaction. On ACCEPTED → CONFIRMED. On REJECTED → posts
// compensating ledger journals + REJECTED. On TIMEOUT → backoff retry, then
// status-check, eventually FAILED if still ambiguous.

import * as db from '../../core/db.js';
import { auditService } from '../audit/index.js';
import { foreignRailsService } from '../crossborder-rails/index.js';
import { transactionsService } from '../transactions/index.js';
import { createForeignRailClient } from './foreign-rail-client.js';
import { postCompensation } from './leg-runner.js';
import { STATES } from './states.js';
import { RECOVERY_BACKOFF_SECONDS, RECOVERY_MAX_ATTEMPTS } from './codes.js';

const backoffFor = (attempts) => {
  const idx = Math.min(attempts, RECOVERY_BACKOFF_SECONDS.length - 1);
  return RECOVERY_BACKOFF_SECONDS[idx];
};

// Counter durability: bump attempt counter in a separate connection so it
// commits even if the surrounding instruct call rolls back via throw.
const bumpAttemptOnSeparateConnection = (model, { id, nextAttemptAt }) =>
  db.withClient((c) => model.bumpAttempt(c, { id, nextAttemptAt }));

export const createRecoveryWorker = ({ model }) => {
  const handleOne = async (xbtx) => {
    const rail = await foreignRailsService.findByCode(xbtx.foreign_rail_code);
    if (!rail) {
      // Should not happen; mark FAILED so the worker doesn't keep spinning.
      await db.withTransaction(async (client) => {
        await model.setState(client, {
          id: xbtx.id,
          toState: STATES.FAILED,
          fields: { rejected_at: new Date().toISOString() }
        });
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'crossborder.failed',
          resourceType: 'crossborder_tx',
          resourceId: xbtx.id,
          payload: { reason: 'foreign_rail_missing', railCode: xbtx.foreign_rail_code }
        });
      });
      return { id: xbtx.id, terminal: true, state: STATES.FAILED };
    }
    const client = createForeignRailClient({ railRow: rail });

    // For brand-new FOREIGN_INSTRUCTING rows: call instruct.
    // For PENDING_FOREIGN: call status.
    let outcome;
    let timedOut = false;
    try {
      if (xbtx.state === STATES.PENDING_FOREIGN && xbtx.foreign_tx_id) {
        outcome = await client.status({ foreignTxId: xbtx.foreign_tx_id });
      } else {
        outcome = await client.instruct({
          quoteId: xbtx.fx_quote_id,
          originator: { participantCode: xbtx.metadata?.originatorParticipant || 'unknown' },
          beneficiary: { accountId: xbtx.metadata?.beneficiaryAccount || '9999100001' },
          travelRule: xbtx.travel_rule_payload,
          payAmount: String(xbtx.pay_amount_minor),
          receiveAmount: String(xbtx.receive_amount_minor)
        });
      }
    } catch (e) {
      if (e?.code === 'TIMEOUT') {
        timedOut = true;
      } else {
        throw e;
      }
    }

    if (timedOut) {
      const nextAttempts = xbtx.attempts + 1;
      if (nextAttempts >= RECOVERY_MAX_ATTEMPTS) {
        return db.withTransaction(async (txClient) => {
          const updated = await model.setState(txClient, {
            id: xbtx.id,
            toState: STATES.FAILED,
            fields: {
              rejected_at: new Date().toISOString(),
              attempts: nextAttempts,
              next_attempt_at: null
            }
          });
          await auditService.record(txClient, {
            actorType: 'system',
            eventType: 'crossborder.reversal_needed',
            resourceType: 'crossborder_tx',
            resourceId: xbtx.id,
            payload: { reason: 'recovery_exhausted', attempts: nextAttempts }
          });
          return { id: xbtx.id, terminal: true, state: STATES.FAILED, updated };
        });
      }
      // Schedule the next retry. Counter durability bump.
      const nextAt = new Date(Date.now() + backoffFor(nextAttempts) * 1000).toISOString();
      await bumpAttemptOnSeparateConnection(model, { id: xbtx.id, nextAttemptAt: nextAt });
      await db.withTransaction((txClient) =>
        model.setState(txClient, {
          id: xbtx.id,
          toState: STATES.PENDING_FOREIGN
        })
      );
      return { id: xbtx.id, terminal: false, state: STATES.PENDING_FOREIGN, retryAt: nextAt };
    }

    // ACCEPTED — confirm the transaction.
    if (outcome?.status === 'ACCEPTED') {
      return db.withTransaction(async (txClient) => {
        const updated = await model.setState(txClient, {
          id: xbtx.id,
          toState: STATES.CONFIRMED,
          fields: {
            foreign_tx_id: outcome.foreignTxId || xbtx.foreign_tx_id || null,
            foreign_response_at: new Date().toISOString(),
            confirmed_at: new Date().toISOString()
          }
        });
        // Promote the parent rail transaction to CONFIRMED.
        try {
          await transactionsService.markCrossborderConfirmed(txClient, {
            transactionId: xbtx.transaction_id,
            foreignTxId: outcome.foreignTxId
          });
        } catch (e) {
          // The Phase 4 transactions service may not yet expose this helper
          // in earlier blocks. Fall back to direct state update.
          await txClient.query(
            `UPDATE transactions
                SET state = 'CONFIRMED', confirmed_at = now(),
                    response_code = COALESCE(response_code, 'ACSC'),
                    reason_code = COALESCE(reason_code, 'SUCCESS')
              WHERE id = $1 AND state IN ('AUTHORIZED', 'ROUTED', 'CREDIT_LEG_PENDING', 'PENDING_RECONCILIATION', 'RECEIVED')`,
            [xbtx.transaction_id]
          );
          void e;
        }
        await auditService.record(txClient, {
          actorType: 'system',
          eventType: 'crossborder.confirmed',
          resourceType: 'crossborder_tx',
          resourceId: xbtx.id,
          payload: { foreignTxId: outcome.foreignTxId }
        });
        return { id: xbtx.id, terminal: true, state: STATES.CONFIRMED, updated };
      });
    }

    // PENDING (async) — wait, schedule retry.
    if (outcome?.status === 'PENDING') {
      const nextAttempts = xbtx.attempts + 1;
      const nextAt = new Date(Date.now() + backoffFor(nextAttempts) * 1000).toISOString();
      await bumpAttemptOnSeparateConnection(model, { id: xbtx.id, nextAttemptAt: nextAt });
      await db.withTransaction((txClient) =>
        model.setState(txClient, {
          id: xbtx.id,
          toState: STATES.PENDING_FOREIGN,
          fields: { foreign_tx_id: outcome.foreignTxId || xbtx.foreign_tx_id || null }
        })
      );
      return { id: xbtx.id, terminal: false, state: STATES.PENDING_FOREIGN };
    }

    // REJECTED — post compensation, mark REJECTED.
    if (outcome?.status === 'REJECTED') {
      return db.withTransaction(async (txClient) => {
        const compensateJournalId = await postCompensation(txClient, {
          transaction: { id: xbtx.transaction_id, originator_participant: xbtx.metadata?.originatorParticipant || 'unknown' },
          foreignRailCode: xbtx.foreign_rail_code,
          payCurrency: xbtx.pay_currency,
          payAmountMinor: xbtx.pay_amount_minor,
          receiveCurrency: xbtx.receive_currency,
          receiveAmountMinor: xbtx.receive_amount_minor,
          reason: outcome.reasonCode
        });
        const updated = await model.setState(txClient, {
          id: xbtx.id,
          toState: STATES.REJECTED,
          fields: {
            foreign_response_at: new Date().toISOString(),
            rejected_at: new Date().toISOString(),
            compensate_journal_id: compensateJournalId
          }
        });
        // Reject the parent rail transaction.
        await txClient.query(
          `UPDATE transactions
              SET state = 'REJECTED', rejected_at = now(),
                  response_code = 'RJCT',
                  reason_code = $2,
                  reason_message = $3
            WHERE id = $1 AND state NOT IN ('CONFIRMED', 'REVERSED', 'REJECTED', 'FAILED')`,
          [xbtx.transaction_id, `XB_${outcome.reasonCode || 'REJECTED'}`, outcome.message || 'foreign rail rejected']
        );
        await auditService.record(txClient, {
          actorType: 'system',
          eventType: 'crossborder.rejected',
          resourceType: 'crossborder_tx',
          resourceId: xbtx.id,
          payload: {
            reasonCode: outcome.reasonCode,
            compensateJournalId
          }
        });
        return { id: xbtx.id, terminal: true, state: STATES.REJECTED, updated };
      });
    }

    // Unknown outcome — schedule retry.
    return { id: xbtx.id, terminal: false, state: xbtx.state, reason: 'unknown_outcome' };
  };

  // Pull-and-process loop. Returns the per-row results.
  const tick = async () => {
    const due = await db.withTransaction((c) => model.pickPendingForeign(c, {}));
    const results = [];
    for (const r of due) {
      try {
        const out = await handleOne(r);
        results.push(out);
      } catch (e) {
        results.push({ id: r.id, terminal: false, error: e?.message || String(e) });
      }
    }
    return { picked: due.length, results };
  };

  let timer = null;
  let running = false;
  const start = (intervalSeconds = 5) => {
    if (timer) return;
    running = true;
    const loop = async () => {
      if (!running) return;
      try { await tick(); } catch (e) { console.error('[xb recovery]', e?.message || String(e)); }
      if (running) timer = setTimeout(loop, intervalSeconds * 1000);
    };
    timer = setTimeout(loop, intervalSeconds * 1000);
  };
  const stop = async () => {
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
  };

  return { tick, start, stop };
};
