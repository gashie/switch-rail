/**
 * Recovery worker model. All SQL touching the recovery columns lives here.
 *
 * The COUNTER_DURABILITY_NOTE in PHASE-4 mandates that `attempts` increments
 * survive even when the surrounding business transaction rolls back — that's
 * why the model exposes `bumpAttemptsOnSeparateConnection`, designed to be
 * called against a `pool.connect()` client outside any wrapping txn.
 */

const TX_RECOVERY_COLS = `id, state, attempts, next_attempt_at, retry_policy_name,
  rail_class, beneficiary_participant, beneficiary_account, originator_participant,
  end_to_end_id, envelope_id, credit_leg_started_at, reason_code, reason_message`;

export const createRecoveryModel = () => ({
  /**
   * Pull the next batch of PENDING_RECONCILIATION transactions whose
   * `next_attempt_at` is in the past (or null — initial entry). Locks them
   * with FOR UPDATE SKIP LOCKED so multiple worker processes can scan
   * concurrently without stepping on each other.
   */
  selectDueForUpdate: async (client, { limit = 10 } = {}) => {
    const r = await client.query(
      `SELECT ${TX_RECOVERY_COLS}
         FROM transactions
        WHERE state = 'PENDING_RECONCILIATION'
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY COALESCE(next_attempt_at, credit_leg_started_at, created_at) ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  },

  findRecoveryRow: async (client, id) => {
    const r = await client.query(
      `SELECT ${TX_RECOVERY_COLS} FROM transactions WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  /**
   * Increment the attempts counter and (optionally) push next_attempt_at on
   * a SEPARATE connection. Crucially, this does NOT participate in any
   * caller-supplied transaction — the count survives a rollback so we can
   * see "the worker tried this five times and we still don't know" rather
   * than "the failed attempt vanished with the rollback".
   */
  bumpAttemptsOnSeparateConnection: async (db, { id, nextAttemptAt, retryPolicyName }) => {
    return db.withClient(async (c) => {
      const r = await c.query(
        `UPDATE transactions
            SET attempts = attempts + 1,
                next_attempt_at = $2,
                retry_policy_name = COALESCE($3, retry_policy_name),
                updated_at = now()
          WHERE id = $1
          RETURNING attempts, next_attempt_at, retry_policy_name`,
        [id, nextAttemptAt || null, retryPolicyName || null]
      );
      return r.rows[0] || null;
    });
  },

  /**
   * Schedule a future retry on the caller's transaction client. Used when
   * the recovery service decides to keep the txn in PENDING_RECONCILIATION
   * for another pass — the schedule update lives inside the same txn that
   * wrote the status-history row so the two stay consistent.
   */
  scheduleNextOnClient: async (client, { id, nextAttemptAt, retryPolicyName }) => {
    const r = await client.query(
      `UPDATE transactions
          SET next_attempt_at = $2,
              retry_policy_name = COALESCE($3, retry_policy_name),
              updated_at = now()
        WHERE id = $1
        RETURNING attempts, next_attempt_at, retry_policy_name`,
      [id, nextAttemptAt, retryPolicyName || null]
    );
    return r.rows[0] || null;
  },

  /** History entries written by the recovery worker, used at exhaustion. */
  listRecoveryHistory: async (client, transactionId) => {
    const r = await client.query(
      `SELECT id, occurred_at, payload
         FROM transaction_status_history
        WHERE transaction_id = $1
          AND occurred_by = 'recovery-worker'
        ORDER BY occurred_at ASC`,
      [transactionId]
    );
    return r.rows;
  },

  /** Lock the transaction's row for the deciding step of one recovery pass. */
  lockForRecovery: async (client, id) => {
    const r = await client.query(
      `SELECT id, state, attempts, retry_policy_name
         FROM transactions
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    return r.rows[0] || null;
  },

  /** Append a recovery-worker entry to transaction_status_history. */
  insertRecoveryHistory: async (
    client,
    { id, transactionId, payload }
  ) => {
    await client.query(
      `INSERT INTO transaction_status_history
         (id, transaction_id, from_state, to_state, reason_code, reason_message, payload, occurred_by)
       VALUES ($1, $2, 'PENDING_RECONCILIATION', 'PENDING_RECONCILIATION',
               NULL, NULL, $3::jsonb, 'recovery-worker')`,
      [id, transactionId, JSON.stringify(payload || {})]
    );
  }
});
