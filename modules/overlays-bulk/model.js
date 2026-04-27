const RUN_COLS = `id, run_number, originator_participant, source_format,
  source_filename, source_sha256, total_lines, total_amount_minor, currency,
  state, succeeded_count, failed_count, succeeded_amount_minor,
  failed_amount_minor, started_at, completed_at, uploaded_by_user, metadata`;

const LINE_COLS = `id, run_id, line_number, envelope_id, transaction_id,
  state, result_code, result_message, amount_minor, beneficiary_participant,
  beneficiary_account, processed_at`;

export const createBulkModel = () => ({
  insertRun: async (
    client,
    {
      id, runNumber, originatorParticipant, sourceFormat, sourceFilename,
      sourceSha256, totalLines, totalAmountMinor, currency, uploadedByUser,
      metadata
    }
  ) => {
    const r = await client.query(
      `INSERT INTO bulk_payment_runs
         (id, run_number, originator_participant, source_format, source_filename,
          source_sha256, total_lines, total_amount_minor, currency, uploaded_by_user,
          metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (originator_participant, source_sha256) DO NOTHING
       RETURNING ${RUN_COLS}`,
      [
        id, runNumber, originatorParticipant, sourceFormat, sourceFilename,
        sourceSha256, totalLines, totalAmountMinor, currency, uploadedByUser ?? null,
        JSON.stringify(metadata || {})
      ]
    );
    return r.rows[0] || null;
  },

  findRunBySha: async (client, { originatorParticipant, sourceSha256 }) => {
    const r = await client.query(
      `SELECT ${RUN_COLS} FROM bulk_payment_runs
        WHERE originator_participant = $1 AND source_sha256 = $2 LIMIT 1`,
      [originatorParticipant, sourceSha256]
    );
    return r.rows[0] || null;
  },

  findRunById: async (client, id) => {
    const r = await client.query(`SELECT ${RUN_COLS} FROM bulk_payment_runs WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  findRunByNumber: async (client, runNumber) => {
    const r = await client.query(`SELECT ${RUN_COLS} FROM bulk_payment_runs WHERE run_number = $1`, [runNumber]);
    return r.rows[0] || null;
  },

  setRunState: async (client, { id, state, fields }) => {
    const sets = ['state = $2'];
    const params = [id, state];
    if (fields) {
      for (const [col, val] of Object.entries(fields)) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const r = await client.query(
      `UPDATE bulk_payment_runs SET ${sets.join(', ')} WHERE id = $1 RETURNING ${RUN_COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  insertLine: async (
    client,
    { id, runId, lineNumber, amountMinor, beneficiaryParticipant, beneficiaryAccount }
  ) => {
    const r = await client.query(
      `INSERT INTO bulk_payment_lines
         (id, run_id, line_number, amount_minor, beneficiary_participant, beneficiary_account)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (run_id, line_number) DO NOTHING
       RETURNING ${LINE_COLS}`,
      [id, runId, lineNumber, amountMinor, beneficiaryParticipant, beneficiaryAccount]
    );
    return r.rows[0] || null;
  },

  setLineResult: async (
    client,
    { runId, lineNumber, state, envelopeId, transactionId, resultCode, resultMessage }
  ) => {
    const r = await client.query(
      `UPDATE bulk_payment_lines
          SET state = $3, envelope_id = $4, transaction_id = $5,
              result_code = $6, result_message = $7, processed_at = now()
        WHERE run_id = $1 AND line_number = $2
        RETURNING ${LINE_COLS}`,
      [runId, lineNumber, state, envelopeId ?? null, transactionId ?? null, resultCode ?? null, resultMessage ?? null]
    );
    return r.rows[0] || null;
  },

  pickPendingLines: async (client, { runId, limit }) => {
    const r = await client.query(
      `SELECT ${LINE_COLS} FROM bulk_payment_lines
        WHERE run_id = $1 AND state = 'PENDING'
        ORDER BY line_number ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2`,
      [runId, limit]
    );
    return r.rows;
  },

  pickQueuedRuns: async (client, limit = 5) => {
    const r = await client.query(
      `SELECT ${RUN_COLS} FROM bulk_payment_runs
        WHERE state IN ('QUEUED', 'RUNNING')
        ORDER BY id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  },

  countLineStates: async (client, runId) => {
    const r = await client.query(
      `SELECT state, count(*)::int AS n,
              COALESCE(SUM(amount_minor), 0)::text AS sum_amount
       FROM bulk_payment_lines WHERE run_id = $1 GROUP BY state`,
      [runId]
    );
    const out = { PENDING: 0, PROCESSING: 0, SUCCEEDED: 0, FAILED: 0, sumByState: {} };
    for (const row of r.rows) {
      out[row.state] = row.n;
      out.sumByState[row.state] = row.sum_amount;
    }
    return out;
  },

  listRuns: async (client, { originatorParticipant, state, limit }) => {
    const conds = [];
    const params = [];
    if (originatorParticipant) { params.push(originatorParticipant); conds.push(`originator_participant = $${params.length}`); }
    if (state) { params.push(state); conds.push(`state = $${params.length}`); }
    params.push(limit ?? 100);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${RUN_COLS} FROM bulk_payment_runs ${where}
        ORDER BY id DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  listLines: async (client, runId, limit = 1000) => {
    const r = await client.query(
      `SELECT ${LINE_COLS} FROM bulk_payment_lines WHERE run_id = $1
        ORDER BY line_number ASC LIMIT $2`,
      [runId, limit]
    );
    return r.rows;
  },

  bumpSequence: async (client, bucket) => {
    const r = await client.query(
      `INSERT INTO bulk_run_sequence (bucket, seq) VALUES ($1, 1)
       ON CONFLICT (bucket) DO UPDATE SET seq = bulk_run_sequence.seq + 1
       RETURNING seq`,
      [bucket]
    );
    return r.rows[0].seq;
  }
});
