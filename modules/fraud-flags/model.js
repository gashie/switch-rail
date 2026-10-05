const FLAG_COLS = `id, flagged_subject_type, flagged_subject_key, flag_type,
  flagged_by, evidence, severity, created_at, expires_at, withdrawn_at`;

export const createFlagsModel = () => ({
  insert: async (
    client,
    {
      id, subjectType, subjectKey, flagType, flaggedBy,
      evidence, severity, expiresAt
    }
  ) => {
    const r = await client.query(
      `INSERT INTO fraud_flags
         (id, flagged_subject_type, flagged_subject_key, flag_type,
          flagged_by, evidence, severity, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       ON CONFLICT (flagged_subject_type, flagged_subject_key, flagged_by, flag_type) DO UPDATE
         SET evidence = EXCLUDED.evidence,
             severity = EXCLUDED.severity,
             expires_at = EXCLUDED.expires_at,
             withdrawn_at = NULL
       RETURNING ${FLAG_COLS}`,
      [
        id, subjectType, subjectKey, flagType, flaggedBy,
        JSON.stringify(evidence || {}), severity, expiresAt || null
      ]
    );
    return r.rows[0];
  },

  withdraw: async (client, { id, withdrawnBy }) => {
    const r = await client.query(
      `UPDATE fraud_flags SET withdrawn_at = now()
        WHERE id = $1
          AND (flagged_by = $2 OR $2 IS NULL)
          AND withdrawn_at IS NULL
        RETURNING ${FLAG_COLS}`,
      [id, withdrawnBy ?? null]
    );
    return r.rows[0] || null;
  },

  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${FLAG_COLS} FROM fraud_flags WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  listActive: async (client, { subjectType, subjectKey, limit }) => {
    const conds = ['withdrawn_at IS NULL', '(expires_at IS NULL OR expires_at > now())'];
    const params = [];
    if (subjectType) {
      params.push(subjectType);
      conds.push(`flagged_subject_type = $${params.length}`);
    }
    if (subjectKey) {
      params.push(subjectKey);
      conds.push(`flagged_subject_key = $${params.length}`);
    }
    params.push(limit);
    const r = await client.query(
      `SELECT ${FLAG_COLS} FROM fraud_flags
        WHERE ${conds.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  // Used by the rule context builder: any active flag for the given
  // subject (account or alias). Returns the highest severity.
  maxActiveSeverity: async (client, { subjectType, subjectKey }) => {
    const r = await client.query(
      `SELECT MAX(severity)::int AS max_sev, count(*)::int AS n
         FROM fraud_flags
        WHERE flagged_subject_type = $1
          AND flagged_subject_key = $2
          AND withdrawn_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())`,
      [subjectType, subjectKey]
    );
    return { maxSeverity: r.rows[0]?.max_sev ?? 0, count: r.rows[0]?.n ?? 0 };
  },

  expireRolloff: async (client) => {
    const r = await client.query(
      `UPDATE fraud_flags
          SET withdrawn_at = now()
        WHERE expires_at IS NOT NULL
          AND expires_at < now()
          AND withdrawn_at IS NULL
        RETURNING id`
    );
    return r.rowCount;
  }
});
