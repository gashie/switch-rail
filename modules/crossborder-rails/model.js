const COLS = `id, rail_code, rail_name, rail_type, participant_id,
  supported_currencies, supported_countries, settlement_model,
  cutover_time_utc, endpoints, metadata, active, created_at, updated_at`;

export const createForeignRailsModel = () => ({
  insert: async (
    client,
    {
      id, railCode, railName, railType, participantId,
      supportedCurrencies, supportedCountries, settlementModel,
      cutoverTimeUtc, endpoints, metadata
    }
  ) => {
    const r = await client.query(
      `INSERT INTO foreign_rails
         (id, rail_code, rail_name, rail_type, participant_id,
          supported_currencies, supported_countries, settlement_model,
          cutover_time_utc, endpoints, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
       ON CONFLICT (rail_code) DO NOTHING
       RETURNING ${COLS}`,
      [
        id, railCode, railName, railType, participantId,
        supportedCurrencies, supportedCountries, settlementModel,
        cutoverTimeUtc ?? null,
        JSON.stringify(endpoints), JSON.stringify(metadata || {})
      ]
    );
    return r.rows[0] || null;
  },

  findByCode: async (client, railCode) => {
    const r = await client.query(`SELECT ${COLS} FROM foreign_rails WHERE rail_code = $1 LIMIT 1`, [railCode]);
    return r.rows[0] || null;
  },

  findById: async (client, id) => {
    const r = await client.query(`SELECT ${COLS} FROM foreign_rails WHERE id = $1 LIMIT 1`, [id]);
    return r.rows[0] || null;
  },

  list: async (client, { active, railType, limit }) => {
    const conds = [];
    const params = [];
    if (active !== undefined) { params.push(active); conds.push(`active = $${params.length}`); }
    if (railType) { params.push(railType); conds.push(`rail_type = $${params.length}`); }
    params.push(limit ?? 100);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${COLS} FROM foreign_rails ${where} ORDER BY rail_code ASC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  // Find rails that can settle a given country+currency pair.
  findForCountryCurrency: async (client, { country, currency }) => {
    const r = await client.query(
      `SELECT ${COLS} FROM foreign_rails
        WHERE active = true
          AND $1 = ANY(supported_countries)
          AND $2 = ANY(supported_currencies)
        ORDER BY rail_code ASC`,
      [country, currency]
    );
    return r.rows;
  },

  setActive: async (client, { id, active }) => {
    const r = await client.query(
      `UPDATE foreign_rails SET active = $2, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
      [id, active]
    );
    return r.rows[0] || null;
  }
});
