const TX_COLS = `id, envelope_id, end_to_end_id, state, rail_class,
  originator_participant, originator_account,
  beneficiary_participant, beneficiary_account,
  amount_value, amount_currency,
  response_code, reason_code, reason_message,
  authorized_at, routed_at, credit_leg_started_at,
  confirmed_at, rejected_at, reversed_at, failed_at,
  reversal_transaction_id, original_transaction_id,
  created_at, updated_at`;

const HISTORY_COLS = `id, transaction_id, from_state, to_state,
  reason_code, reason_message, payload, occurred_at, occurred_by`;

export const TX_COLUMNS = TX_COLS;
export const HISTORY_COLUMNS = HISTORY_COLS;

export const createTransactionsModel = () => ({
  insertOnConflictReturn: async (
    client,
    {
      id,
      envelopeId,
      endToEndId,
      state,
      railClass,
      originatorParticipant,
      originatorAccount,
      beneficiaryParticipant,
      beneficiaryAccount,
      amountValue,
      amountCurrency
    }
  ) => {
    const r = await client.query(
      `INSERT INTO transactions (
        id, envelope_id, end_to_end_id, state, rail_class,
        originator_participant, originator_account,
        beneficiary_participant, beneficiary_account,
        amount_value, amount_currency
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7,
        $8, $9,
        $10, $11
      )
      ON CONFLICT (envelope_id) WHERE original_transaction_id IS NULL DO NOTHING
      RETURNING ${TX_COLS}`,
      [
        id,
        envelopeId,
        endToEndId,
        state,
        railClass,
        originatorParticipant,
        originatorAccount,
        beneficiaryParticipant,
        beneficiaryAccount,
        amountValue,
        amountCurrency
      ]
    );
    return r.rows[0] || null;
  },

  insertReversal: async (
    client,
    {
      id,
      envelopeId,
      endToEndId,
      state,
      railClass,
      originatorParticipant,
      originatorAccount,
      beneficiaryParticipant,
      beneficiaryAccount,
      amountValue,
      amountCurrency,
      originalTransactionId
    }
  ) => {
    const r = await client.query(
      `INSERT INTO transactions (
        id, envelope_id, end_to_end_id, state, rail_class,
        originator_participant, originator_account,
        beneficiary_participant, beneficiary_account,
        amount_value, amount_currency, original_transaction_id
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7,
        $8, $9,
        $10, $11, $12
      )
      RETURNING ${TX_COLS}`,
      [
        id,
        envelopeId,
        endToEndId,
        state,
        railClass,
        originatorParticipant,
        originatorAccount,
        beneficiaryParticipant,
        beneficiaryAccount,
        amountValue,
        amountCurrency,
        originalTransactionId
      ]
    );
    return r.rows[0];
  },

  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${TX_COLS} FROM transactions WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  findByEnvelopeId: async (client, envelopeId) => {
    const r = await client.query(
      `SELECT ${TX_COLS} FROM transactions
        WHERE envelope_id = $1 AND original_transaction_id IS NULL
        LIMIT 1`,
      [envelopeId]
    );
    return r.rows[0] || null;
  },

  findByEndToEndId: async (client, endToEndId) => {
    const r = await client.query(
      `SELECT ${TX_COLS} FROM transactions WHERE end_to_end_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [endToEndId]
    );
    return r.rows[0] || null;
  },

  applyTransition: async (
    client,
    {
      id,
      fromState,
      toState,
      reasonCode,
      reasonMessage,
      responseCode,
      timestampColumn
    }
  ) => {
    const sets = [`state = $2`, `updated_at = now()`];
    const params = [id, toState];
    let idx = params.length;
    if (reasonCode !== undefined) {
      idx += 1;
      sets.push(`reason_code = $${idx}`);
      params.push(reasonCode);
    }
    if (reasonMessage !== undefined) {
      idx += 1;
      sets.push(`reason_message = $${idx}`);
      params.push(reasonMessage);
    }
    if (responseCode !== undefined) {
      idx += 1;
      sets.push(`response_code = $${idx}`);
      params.push(responseCode);
    }
    if (timestampColumn) {
      sets.push(`${timestampColumn} = now()`);
    }
    const r = await client.query(
      `UPDATE transactions SET ${sets.join(', ')} WHERE id = $1 AND state = $${idx + 1} RETURNING ${TX_COLS}`,
      [...params, fromState]
    );
    return r.rows[0] || null;
  },

  insertHistory: async (
    client,
    { id, transactionId, fromState, toState, reasonCode, reasonMessage, payload, occurredBy }
  ) => {
    const r = await client.query(
      `INSERT INTO transaction_status_history
         (id, transaction_id, from_state, to_state, reason_code, reason_message, payload, occurred_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING ${HISTORY_COLS}`,
      [
        id,
        transactionId,
        fromState ?? null,
        toState,
        reasonCode ?? null,
        reasonMessage ?? null,
        JSON.stringify(payload || {}),
        occurredBy
      ]
    );
    return r.rows[0];
  },

  listHistory: async (client, transactionId) => {
    const r = await client.query(
      `SELECT ${HISTORY_COLS} FROM transaction_status_history
        WHERE transaction_id = $1 ORDER BY occurred_at ASC, id ASC`,
      [transactionId]
    );
    return r.rows;
  },

  listForParticipant: async (client, participantCode, { state, limit, offset }) => {
    const conds = [`(originator_participant = $1 OR beneficiary_participant = $1)`];
    const params = [participantCode];
    if (state) {
      params.push(state);
      conds.push(`state = $${params.length}`);
    }
    params.push(limit);
    params.push(offset);
    const rows = await client.query(
      `SELECT ${TX_COLS} FROM transactions WHERE ${conds.join(' AND ')}
        ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await client.query(
      `SELECT count(*)::bigint AS n FROM transactions WHERE ${conds.join(' AND ')}`,
      params.slice(0, -2)
    );
    return { rows: rows.rows, total: Number(total.rows[0].n) };
  },

  listPendingReconciliationDue: async (client, { olderThanSeconds = 0, limit = 10 }) => {
    const r = await client.query(
      `SELECT ${TX_COLS} FROM transactions
        WHERE state = 'PENDING_RECONCILIATION'
          AND credit_leg_started_at <= now() - ($1 || ' seconds')::interval
        ORDER BY credit_leg_started_at ASC
        LIMIT $2`,
      [String(olderThanSeconds), limit]
    );
    return r.rows;
  },

  setRailClass: async (client, id, railClass) => {
    await client.query(
      `UPDATE transactions SET rail_class = $2, updated_at = now() WHERE id = $1`,
      [id, railClass]
    );
  },

  // Authorization-pipeline pre-fetch helpers. Counts and sums are computed
  // server-side (NUMERIC, BIGINT) and converted to BigInt at the model edge
  // so the orchestrator stays in BigInt-money territory throughout.
  countRecentByOriginatorAndE2E: async (
    client,
    { participantCode, endToEndId, excludeId, days = 7 }
  ) => {
    const r = await client.query(
      `SELECT id FROM transactions
        WHERE originator_participant = $1
          AND end_to_end_id = $2
          AND id <> $3
          AND created_at > now() - ($4 || ' days')::interval
        LIMIT 50`,
      [participantCode, endToEndId, excludeId || '00000000-0000-0000-0000-000000000000', String(days)]
    );
    return r.rows;
  },

  sumVolumeForOriginator: async (
    client,
    { participantCode, withinIntervalSeconds, includeStates }
  ) => {
    const states = includeStates || [
      'AUTHORIZED',
      'ROUTED',
      'CREDIT_LEG_PENDING',
      'CONFIRMED',
      'PENDING_RECONCILIATION'
    ];
    const r = await client.query(
      `SELECT COALESCE(SUM(amount_value), 0)::text AS total
         FROM transactions
        WHERE originator_participant = $1
          AND created_at >= now() - ($2 || ' seconds')::interval
          AND state = ANY($3::text[])`,
      [participantCode, String(withinIntervalSeconds), states]
    );
    return BigInt(r.rows[0].total);
  }
});
