const COLS = `id, case_id, decision_type, outcome, outcome_amount_minor,
  rationale_code, rationale_notes, decided_by_user, decided_at,
  evidence_considered`;

export const createDecisionModel = () => ({
  insert: async (
    client,
    {
      id, caseId, decisionType, outcome, outcomeAmountMinor,
      rationaleCode, rationaleNotes, decidedByUser, evidenceConsidered
    }
  ) => {
    const r = await client.query(
      `INSERT INTO dispute_decisions
         (id, case_id, decision_type, outcome, outcome_amount_minor,
          rationale_code, rationale_notes, decided_by_user, evidence_considered)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (case_id) DO NOTHING
       RETURNING ${COLS}`,
      [
        id, caseId, decisionType, outcome, outcomeAmountMinor ?? null,
        rationaleCode, rationaleNotes ?? null, decidedByUser ?? null,
        JSON.stringify(evidenceConsidered ?? null)
      ]
    );
    return r.rows[0] || null;
  },

  findByCaseId: async (client, caseId) => {
    const r = await client.query(
      `SELECT ${COLS} FROM dispute_decisions WHERE case_id = $1 LIMIT 1`,
      [caseId]
    );
    return r.rows[0] || null;
  }
});
