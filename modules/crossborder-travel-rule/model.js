const COLS = `id, crossborder_tx_id, transaction_id, direction,
  originator_id_type, originator_id_hashed, originator_address,
  originator_dob, originator_jurisdiction,
  beneficiary_id_type, beneficiary_id_hashed, beneficiary_address,
  beneficiary_dob, beneficiary_jurisdiction,
  purpose_of_payment, sanctions_screened_at, sanctions_hit,
  sanctions_hit_details, enforced_at`;

export const createTravelRuleModel = () => ({
  insert: async (
    client,
    {
      id, crossborderTxId, transactionId, direction, travelRule,
      sanctionsScreenedAt, sanctionsHit, sanctionsHitDetails
    }
  ) => {
    const r = await client.query(
      `INSERT INTO travel_rule_records
         (id, crossborder_tx_id, transaction_id, direction,
          originator_id_type, originator_id_hashed, originator_address,
          originator_dob, originator_jurisdiction,
          beneficiary_id_type, beneficiary_id_hashed, beneficiary_address,
          beneficiary_dob, beneficiary_jurisdiction,
          purpose_of_payment, sanctions_screened_at, sanctions_hit,
          sanctions_hit_details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
       RETURNING ${COLS}`,
      [
        id, crossborderTxId ?? null, transactionId ?? null, direction,
        travelRule.originatorIdType, travelRule.originatorIdHashed, travelRule.originatorAddress,
        travelRule.originatorDateOfBirth ?? null, travelRule.jurisdictionOfOriginator,
        travelRule.beneficiaryIdType, travelRule.beneficiaryIdHashed, travelRule.beneficiaryAddress,
        travelRule.beneficiaryDateOfBirth ?? null, travelRule.jurisdictionOfBeneficiary,
        travelRule.purposeOfPayment, sanctionsScreenedAt ?? new Date().toISOString(),
        !!sanctionsHit, JSON.stringify(sanctionsHitDetails || null)
      ]
    );
    return r.rows[0];
  },

  list: async (client, { crossborderTxId, direction, limit }) => {
    const conds = [];
    const params = [];
    if (crossborderTxId) { params.push(crossborderTxId); conds.push(`crossborder_tx_id = $${params.length}`); }
    if (direction) { params.push(direction); conds.push(`direction = $${params.length}`); }
    params.push(limit ?? 100);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${COLS} FROM travel_rule_records ${where}
        ORDER BY enforced_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  }
});
