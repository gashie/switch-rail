const ALIAS_COLS = `id, alias_type, alias_value, alias_value_display, account_id,
  participant_code, status, verification_method, verified_at, revoked_at,
  created_at, updated_at`;

export const createAliasesModel = () => ({
  insertOnConflictReturn: async (
    client,
    {
      id,
      aliasType,
      aliasValue,
      aliasValueDisplay,
      accountId,
      participantCode,
      status,
      verificationMethod,
      verifiedAt
    }
  ) => {
    const r = await client.query(
      `INSERT INTO aliases
        (id, alias_type, alias_value, alias_value_display, account_id, participant_code, status, verification_method, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (alias_type, alias_value) WHERE status IN ('pending','verified') DO NOTHING
       RETURNING ${ALIAS_COLS}`,
      [
        id,
        aliasType,
        aliasValue,
        aliasValueDisplay,
        accountId,
        participantCode,
        status || 'pending',
        verificationMethod ?? null,
        verifiedAt ?? null
      ]
    );
    return r.rows[0] || null;
  },

  findActiveByValue: async (client, { aliasType, aliasValue }) => {
    const r = await client.query(
      `SELECT ${ALIAS_COLS} FROM aliases
        WHERE alias_type = $1 AND alias_value = $2
          AND status IN ('pending','verified')
        LIMIT 1`,
      [aliasType, aliasValue]
    );
    return r.rows[0] || null;
  },

  findVerifiedByValue: async (client, { aliasType, aliasValue }) => {
    const r = await client.query(
      `SELECT ${ALIAS_COLS} FROM aliases
        WHERE alias_type = $1 AND alias_value = $2 AND status = 'verified'
        LIMIT 1`,
      [aliasType, aliasValue]
    );
    return r.rows[0] || null;
  },

  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${ALIAS_COLS} FROM aliases WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  listByAccount: async (client, accountId) => {
    const r = await client.query(
      `SELECT ${ALIAS_COLS} FROM aliases WHERE account_id = $1 ORDER BY created_at DESC`,
      [accountId]
    );
    return r.rows;
  },

  setStatus: async (client, { id, status, verificationMethod, verifiedAt, revokedAt }) => {
    const cols = [`status = $2`, `updated_at = now()`];
    const params = [id, status];
    if (verificationMethod !== undefined) {
      cols.push(`verification_method = $${params.length + 1}`);
      params.push(verificationMethod);
    }
    if (verifiedAt !== undefined) {
      cols.push(`verified_at = $${params.length + 1}`);
      params.push(verifiedAt);
    }
    if (revokedAt !== undefined) {
      cols.push(`revoked_at = $${params.length + 1}`);
      params.push(revokedAt);
    }
    const r = await client.query(
      `UPDATE aliases SET ${cols.join(', ')} WHERE id = $1 RETURNING ${ALIAS_COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  updateAccount: async (client, { id, accountId, participantCode }) => {
    const r = await client.query(
      `UPDATE aliases SET account_id = $2, participant_code = $3, updated_at = now()
        WHERE id = $1 RETURNING ${ALIAS_COLS}`,
      [id, accountId, participantCode]
    );
    return r.rows[0] || null;
  }
});
