const ACCOUNT_COLUMNS = `id, participant_id, participant_code, account_type, account_number,
  account_name, account_name_normalized, currency, status, metadata,
  opened_at, closed_at, created_at, updated_at`;

export const createDirectoryModel = () => ({
  insertOnConflictReturn: async (
    client,
    {
      id,
      participantId,
      participantCode,
      accountType,
      accountNumber,
      accountName,
      accountNameNormalized,
      currency,
      metadata
    }
  ) => {
    const r = await client.query(
      `INSERT INTO accounts (
        id, participant_id, participant_code, account_type, account_number,
        account_name, account_name_normalized, currency, status, metadata
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, 'active', $9::jsonb
      )
      ON CONFLICT (participant_code, account_number) DO NOTHING
      RETURNING ${ACCOUNT_COLUMNS}`,
      [
        id,
        participantId,
        participantCode,
        accountType,
        accountNumber,
        accountName,
        accountNameNormalized,
        currency,
        JSON.stringify(metadata || {})
      ]
    );
    return r.rows[0] || null;
  },

  findByAccount: async (client, { participantCode, accountNumber }) => {
    const r = await client.query(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts
        WHERE participant_code = $1 AND account_number = $2 LIMIT 1`,
      [participantCode, accountNumber]
    );
    return r.rows[0] || null;
  },

  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  setStatus: async (client, { participantCode, accountNumber, status, closedAt }) => {
    const cols = [`status = $3`, `updated_at = now()`];
    const params = [participantCode, accountNumber, status];
    if (closedAt !== undefined) {
      cols.push(`closed_at = $4`);
      params.push(closedAt);
    }
    const r = await client.query(
      `UPDATE accounts SET ${cols.join(', ')}
        WHERE participant_code = $1 AND account_number = $2
        RETURNING ${ACCOUNT_COLUMNS}`,
      params
    );
    return r.rows[0] || null;
  },

  list: async (client, { participantCode, accountType, status, limit, offset }) => {
    const conds = [];
    const params = [];
    const push = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (participantCode) conds.push(`participant_code = ${push(participantCode)}`);
    if (accountType) conds.push(`account_type = ${push(accountType)}`);
    if (status) conds.push(`status = ${push(status)}`);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rowsR = await client.query(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts ${where} ORDER BY created_at DESC LIMIT ${push(limit)} OFFSET ${push(offset)}`,
      params
    );
    const totalR = await client.query(
      `SELECT count(*)::bigint AS total FROM accounts ${where}`,
      params.slice(0, params.length - 2)
    );
    return { rows: rowsR.rows, total: Number(totalR.rows[0].total) };
  },

  searchByName: async (client, { participantCode, pattern, limit }) => {
    const r = await client.query(
      `SELECT ${ACCOUNT_COLUMNS},
              similarity(account_name_normalized, $2) AS score
         FROM accounts
        WHERE participant_code = $1
          AND status = 'active'
          AND account_name_normalized % $2
        ORDER BY score DESC
        LIMIT $3`,
      [participantCode, pattern, limit]
    );
    return r.rows;
  }
});
