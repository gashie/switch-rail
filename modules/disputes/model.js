const CASE_COLS = `id, case_number, transaction_id, reason_code,
  filing_participant, filing_user_ref, verification_fingerprint,
  amount_minor, currency, state, filed_at, accepted_at,
  evidence_pending_until, adjudicating_at, resolved_at, outcome,
  outcome_amount_minor, outcome_notes, reserve_journal_id,
  release_journal_id, metadata, created_at, updated_at`;

export const createDisputesModel = () => ({
  insertCase: async (
    client,
    {
      id, caseNumber, transactionId, reasonCode, filingParticipant,
      filingUserRef, verificationFingerprint, amountMinor, currency,
      state, metadata
    }
  ) => {
    const r = await client.query(
      `INSERT INTO dispute_cases
         (id, case_number, transaction_id, reason_code, filing_participant,
          filing_user_ref, verification_fingerprint, amount_minor, currency,
          state, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING ${CASE_COLS}`,
      [
        id, caseNumber, transactionId, reasonCode, filingParticipant,
        filingUserRef ?? null, verificationFingerprint ?? null,
        amountMinor, currency, state || 'FILED',
        JSON.stringify(metadata || {})
      ]
    );
    return r.rows[0];
  },

  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${CASE_COLS} FROM dispute_cases WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  findByCaseNumber: async (client, caseNumber) => {
    const r = await client.query(
      `SELECT ${CASE_COLS} FROM dispute_cases WHERE case_number = $1 LIMIT 1`,
      [caseNumber]
    );
    return r.rows[0] || null;
  },

  listForParticipant: async (client, { filingParticipant, state, reasonCode, limit, offset }) => {
    const conds = ['filing_participant = $1'];
    const params = [filingParticipant];
    if (state) { params.push(state); conds.push(`state = $${params.length}`); }
    if (reasonCode) { params.push(reasonCode); conds.push(`reason_code = $${params.length}`); }
    params.push(limit ?? 100);
    params.push(offset ?? 0);
    const r = await client.query(
      `SELECT ${CASE_COLS} FROM dispute_cases WHERE ${conds.join(' AND ')}
        ORDER BY filed_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  },

  listForTransaction: async (client, transactionId) => {
    const r = await client.query(
      `SELECT ${CASE_COLS} FROM dispute_cases WHERE transaction_id = $1
        ORDER BY filed_at DESC`,
      [transactionId]
    );
    return r.rows;
  },

  list: async (client, { state, reasonCode, filingParticipant, limit, offset }) => {
    const conds = [];
    const params = [];
    if (state) { params.push(state); conds.push(`state = $${params.length}`); }
    if (reasonCode) { params.push(reasonCode); conds.push(`reason_code = $${params.length}`); }
    if (filingParticipant) { params.push(filingParticipant); conds.push(`filing_participant = $${params.length}`); }
    params.push(limit ?? 100);
    params.push(offset ?? 0);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${CASE_COLS} FROM dispute_cases ${where}
        ORDER BY filed_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  },

  setState: async (client, { id, toState, fields }) => {
    const sets = ['state = $2', 'updated_at = now()'];
    const params = [id, toState];
    if (fields) {
      for (const [col, val] of Object.entries(fields)) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const r = await client.query(
      `UPDATE dispute_cases SET ${sets.join(', ')} WHERE id = $1 RETURNING ${CASE_COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  insertHistory: async (client, { id, caseId, fromState, toState, reason, payload, occurredBy }) => {
    const r = await client.query(
      `INSERT INTO dispute_status_history
         (id, case_id, from_state, to_state, reason, payload, occurred_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING id, case_id, from_state, to_state, reason, payload, occurred_at, occurred_by`,
      [id, caseId, fromState, toState, reason ?? null, JSON.stringify(payload || {}), occurredBy]
    );
    return r.rows[0];
  },

  listHistory: async (client, caseId) => {
    const r = await client.query(
      `SELECT id, case_id, from_state, to_state, reason, payload, occurred_at, occurred_by
       FROM dispute_status_history WHERE case_id = $1 ORDER BY occurred_at ASC`,
      [caseId]
    );
    return r.rows;
  },

  // Per-month sequence increment. Row-locked via INSERT ON CONFLICT DO UPDATE
  // RETURNING so concurrent filings get monotonically distinct seq values.
  bumpCaseSequence: async (client, bucket) => {
    const r = await client.query(
      `INSERT INTO dispute_case_sequence (bucket, seq)
       VALUES ($1, 1)
       ON CONFLICT (bucket) DO UPDATE SET seq = dispute_case_sequence.seq + 1
       RETURNING seq`,
      [bucket]
    );
    return r.rows[0].seq;
  },

  // Filing rate-limit count: how many disputes did this customer file in the
  // last `windowHours` for this participant?
  countFilingsForCustomer: async (client, { filingParticipant, filingUserRef, windowHours }) => {
    const r = await client.query(
      `SELECT count(*)::int AS n FROM dispute_cases
        WHERE filing_participant = $1
          AND filing_user_ref = $2
          AND filed_at >= now() - ($3 || ' hours')::interval`,
      [filingParticipant, filingUserRef, String(windowHours)]
    );
    return r.rows[0]?.n ?? 0;
  },

  // Idempotency: did the same filer file the same reason against the same
  // tx in the last 24h?
  findRecentDuplicateFiling: async (client, { transactionId, reasonCode, filingParticipant }) => {
    const r = await client.query(
      `SELECT ${CASE_COLS} FROM dispute_cases
        WHERE transaction_id = $1 AND reason_code = $2 AND filing_participant = $3
          AND filed_at >= now() - interval '24 hours'
        ORDER BY filed_at DESC LIMIT 1`,
      [transactionId, reasonCode, filingParticipant]
    );
    return r.rows[0] || null;
  }
});
