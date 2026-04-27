const RUN_COLS = `id, participant_code, currency, operating_date, run_type,
  state, total_compared, total_matched, total_breaks,
  started_at, completed_at, metadata`;

const BREAK_COLS = `id, run_id, break_type, rail_transaction_id, participant_ref,
  amount_minor, currency, rail_state, participant_state,
  resolution, resolved_at, resolved_by, notes, created_at`;

export const createReconModel = () => ({
  insertRun: async (
    client,
    { id, participantCode, currency, operatingDate, runType }
  ) => {
    const r = await client.query(
      `INSERT INTO reconciliation_runs
         (id, participant_code, currency, operating_date, run_type, state, started_at)
       VALUES ($1, $2, $3, $4, $5, 'running', now())
       RETURNING ${RUN_COLS}`,
      [id, participantCode, currency, operatingDate, runType]
    );
    return r.rows[0];
  },

  completeRun: async (
    client,
    { id, totalCompared, totalMatched, totalBreaks }
  ) => {
    const r = await client.query(
      `UPDATE reconciliation_runs
          SET state = 'completed',
              completed_at = now(),
              total_compared = $2,
              total_matched = $3,
              total_breaks = $4
        WHERE id = $1
        RETURNING ${RUN_COLS}`,
      [id, totalCompared, totalMatched, totalBreaks]
    );
    return r.rows[0];
  },

  findRun: async (client, id) => {
    const r = await client.query(
      `SELECT ${RUN_COLS} FROM reconciliation_runs WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  listRuns: async (client, { participantCode, currency, operatingDate, runType, limit }) => {
    const conds = [];
    const params = [];
    if (participantCode) {
      params.push(participantCode);
      conds.push(`participant_code = $${params.length}`);
    }
    if (currency) {
      params.push(currency);
      conds.push(`currency = $${params.length}`);
    }
    if (operatingDate) {
      params.push(operatingDate);
      conds.push(`operating_date = $${params.length}`);
    }
    if (runType) {
      params.push(runType);
      conds.push(`run_type = $${params.length}`);
    }
    params.push(limit);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${RUN_COLS} FROM reconciliation_runs ${where}
        ORDER BY started_at DESC NULLS LAST LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  insertBreak: async (
    client,
    {
      id,
      runId,
      breakType,
      railTransactionId,
      participantRef,
      amountMinor,
      currency,
      railState,
      participantState,
      notes
    }
  ) => {
    const r = await client.query(
      `INSERT INTO reconciliation_breaks
         (id, run_id, break_type, rail_transaction_id, participant_ref,
          amount_minor, currency, rail_state, participant_state, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${BREAK_COLS}`,
      [
        id,
        runId,
        breakType,
        railTransactionId ?? null,
        participantRef ?? null,
        amountMinor != null ? String(amountMinor) : null,
        currency ?? null,
        railState ?? null,
        participantState ?? null,
        notes ?? null
      ]
    );
    return r.rows[0];
  },

  listBreaksForRun: async (client, runId) => {
    const r = await client.query(
      `SELECT ${BREAK_COLS} FROM reconciliation_breaks
        WHERE run_id = $1
        ORDER BY created_at ASC`,
      [runId]
    );
    return r.rows;
  },

  listBreaks: async (client, { resolution, participantCode, limit }) => {
    const conds = [];
    const params = [];
    if (resolution) {
      params.push(resolution);
      conds.push(`b.resolution = $${params.length}`);
    }
    if (participantCode) {
      params.push(participantCode);
      conds.push(`r.participant_code = $${params.length}`);
    }
    params.push(limit);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await client.query(
      `SELECT ${BREAK_COLS.split(',').map((c) => `b.${c.trim()}`).join(', ')},
              r.participant_code, r.operating_date, r.run_type
         FROM reconciliation_breaks b
         JOIN reconciliation_runs r ON r.id = b.run_id
        ${where}
        ORDER BY b.created_at DESC
        LIMIT $${params.length}`,
      params
    );
    return rows.rows;
  },

  resolveBreak: async (
    client,
    { id, resolution, resolvedBy, notes }
  ) => {
    const r = await client.query(
      `UPDATE reconciliation_breaks
          SET resolution = $2,
              resolved_at = now(),
              resolved_by = $3,
              notes = COALESCE(notes, '') || E'\n' || $4
        WHERE id = $1
        RETURNING ${BREAK_COLS}`,
      [id, resolution, resolvedBy ?? null, notes ?? '']
    );
    return r.rows[0] || null;
  },

  // Pull the rail's view of a participant+currency+date: every CONFIRMED
  // transaction with the participant on either side, plus its current state.
  railView: async (client, { participantCode, currency, operatingDate }) => {
    const r = await client.query(
      `SELECT id, end_to_end_id, originator_participant, beneficiary_participant,
              amount_value, amount_currency, state, operating_date
         FROM transactions
        WHERE operating_date = $1
          AND amount_currency = $2
          AND (originator_participant = $3 OR beneficiary_participant = $3)
          AND state IN ('CONFIRMED', 'REVERSED', 'FAILED', 'PENDING_RECONCILIATION')`,
      [operatingDate, currency, participantCode]
    );
    return r.rows;
  }
});
