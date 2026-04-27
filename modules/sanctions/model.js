// All SQL touching watchlist_entries / watchlist_screenings lives here.

const ENTRY_COLS = `id, source, list_type, source_record_id, primary_name, primary_name_norm,
  aliases, alias_norms, countries, date_of_birth, ghanacard_pin, account_numbers,
  reason, added_at, removed_at, metadata`;

const SCREENING_COLS = `id, transaction_id, party, query_name, query_account,
  hit, matches, screened_at`;

export const createSanctionsModel = () => ({
  insertEntry: async (
    client,
    {
      id, source, listType, sourceRecordId,
      primaryName, primaryNameNorm,
      aliases, aliasNorms,
      countries, dateOfBirth, ghanacardPin, accountNumbers,
      reason, metadata
    }
  ) => {
    const r = await client.query(
      `INSERT INTO watchlist_entries
         (id, source, list_type, source_record_id, primary_name, primary_name_norm,
          aliases, alias_norms, countries, date_of_birth, ghanacard_pin, account_numbers,
          reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
       RETURNING ${ENTRY_COLS}`,
      [
        id, source, listType, sourceRecordId ?? null,
        primaryName, primaryNameNorm,
        aliases || [], aliasNorms || [],
        countries || null, dateOfBirth || null, ghanacardPin || null, accountNumbers || null,
        reason || null, JSON.stringify(metadata || {})
      ]
    );
    return r.rows[0];
  },

  removeEntry: async (client, id) => {
    await client.query(
      `UPDATE watchlist_entries SET removed_at = now() WHERE id = $1 AND removed_at IS NULL`,
      [id]
    );
  },

  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${ENTRY_COLS} FROM watchlist_entries WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  listEntries: async (client, { source, listType, active = true, limit = 100 }) => {
    const conds = [];
    const params = [];
    if (active) conds.push('removed_at IS NULL');
    if (source) {
      params.push(source);
      conds.push(`source = $${params.length}`);
    }
    if (listType) {
      params.push(listType);
      conds.push(`list_type = $${params.length}`);
    }
    params.push(limit);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${ENTRY_COLS} FROM watchlist_entries ${where}
        ORDER BY added_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  // Direct-key checks: Ghanacard PIN, exact account number.
  findByGhanacardPin: async (client, pin) => {
    const r = await client.query(
      `SELECT ${ENTRY_COLS} FROM watchlist_entries
        WHERE ghanacard_pin = $1 AND removed_at IS NULL
        LIMIT 5`,
      [pin]
    );
    return r.rows;
  },

  findByAccountNumber: async (client, accountNumber) => {
    const r = await client.query(
      `SELECT ${ENTRY_COLS} FROM watchlist_entries
        WHERE $1 = ANY(account_numbers) AND removed_at IS NULL
        LIMIT 5`,
      [accountNumber]
    );
    return r.rows;
  },

  // Trigram fuzzy match on primary_name_norm + alias_norms. Returns top 10
  // candidates by similarity for in-process Jaro-Winkler confirmation.
  findFuzzyCandidates: async (client, normalizedQuery) => {
    const r = await client.query(
      `SELECT ${ENTRY_COLS},
              GREATEST(
                similarity(primary_name_norm, $1),
                COALESCE(
                  (SELECT MAX(similarity(a, $1)) FROM unnest(alias_norms) a),
                  0
                )
              ) AS sim
         FROM watchlist_entries
        WHERE removed_at IS NULL
          AND (
            primary_name_norm % $1
            OR EXISTS (SELECT 1 FROM unnest(alias_norms) a WHERE a % $1)
          )
        ORDER BY sim DESC
        LIMIT 10`,
      [normalizedQuery]
    );
    return r.rows;
  },

  insertScreening: async (
    client,
    { id, transactionId, party, queryName, queryAccount, hit, matches }
  ) => {
    const r = await client.query(
      `INSERT INTO watchlist_screenings
         (id, transaction_id, party, query_name, query_account, hit, matches)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING ${SCREENING_COLS}`,
      [
        id, transactionId || null, party, queryName, queryAccount || null,
        hit, JSON.stringify(matches || [])
      ]
    );
    return r.rows[0];
  },

  listScreeningsForTransaction: async (client, transactionId) => {
    const r = await client.query(
      `SELECT ${SCREENING_COLS} FROM watchlist_screenings
        WHERE transaction_id = $1
        ORDER BY screened_at ASC`,
      [transactionId]
    );
    return r.rows;
  },

  findBySourceRecord: async (client, source, sourceRecordId) => {
    const r = await client.query(
      `SELECT id FROM watchlist_entries
        WHERE source = $1 AND source_record_id = $2 AND removed_at IS NULL
        LIMIT 1`,
      [source, sourceRecordId]
    );
    return r.rows[0] || null;
  }
});
