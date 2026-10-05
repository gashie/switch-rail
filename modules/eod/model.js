const DAY_COLS = `id, operating_date, state, opened_at, cutover_at, closed_at,
  closing_journal_seq, closing_chain_hash, metadata`;

const STMT_COLS = `id, operating_day_id, operating_date, participant_code,
  currency, opening_position_minor, total_credits_minor, total_debits_minor,
  total_fees_minor, cycle_count, net_settled_minor, closing_position_minor,
  payload, signature_b64, signature_kid, signature_alg, issued_at`;

export const createEodModel = () => ({
  ensureOpenDay: async (client, { id, operatingDate }) => {
    const r = await client.query(
      `INSERT INTO operating_days (id, operating_date, state, opened_at)
       VALUES ($1, $2, 'OPEN', now())
       ON CONFLICT (operating_date) DO NOTHING
       RETURNING ${DAY_COLS}`,
      [id, operatingDate]
    );
    if (r.rows[0]) return r.rows[0];
    const fetched = await client.query(
      `SELECT ${DAY_COLS} FROM operating_days WHERE operating_date = $1 LIMIT 1`,
      [operatingDate]
    );
    return fetched.rows[0];
  },

  findByDate: async (client, operatingDate) => {
    const r = await client.query(
      `SELECT ${DAY_COLS} FROM operating_days WHERE operating_date = $1 LIMIT 1`,
      [operatingDate]
    );
    return r.rows[0] || null;
  },

  findByDateForUpdate: async (client, operatingDate) => {
    const r = await client.query(
      `SELECT ${DAY_COLS} FROM operating_days WHERE operating_date = $1 FOR UPDATE`,
      [operatingDate]
    );
    return r.rows[0] || null;
  },

  listDays: async (client, { limit = 50 }) => {
    const r = await client.query(
      `SELECT ${DAY_COLS} FROM operating_days ORDER BY operating_date DESC LIMIT $1`,
      [limit]
    );
    return r.rows;
  },

  setDayState: async (client, { id, state, fields }) => {
    const sets = ['state = $2'];
    const params = [id, state];
    if (fields) {
      for (const [col, val] of Object.entries(fields)) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const r = await client.query(
      `UPDATE operating_days SET ${sets.join(', ')} WHERE id = $1 RETURNING ${DAY_COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  // Aggregates over the day's ledger journals/postings for a single
  // participant + currency. Returns digit-strings; service wraps in BigInt.
  participantDayAggregates: async (
    client,
    { participantCode, currency, operatingDate }
  ) => {
    const accountCode = `PSET:${participantCode}:${currency}`;
    const r = await client.query(
      `SELECT
         COALESCE(SUM(CASE WHEN p.side = 'CR' THEN p.amount_value ELSE 0 END), 0)::text AS total_credits,
         COALESCE(SUM(CASE WHEN p.side = 'DR' THEN p.amount_value ELSE 0 END), 0)::text AS total_debits
         FROM ledger_postings p
         JOIN ledger_journal j ON j.id = p.journal_id
        WHERE p.account_code = $1
          AND j.operating_date = $2`,
      [accountCode, operatingDate]
    );
    const cyclesR = await client.query(
      `SELECT COUNT(*)::int AS n,
              COALESCE(SUM(CASE WHEN p.side = 'CR' THEN p.amount_value ELSE -p.amount_value END), 0)::text AS net_settled
         FROM ledger_postings p
         JOIN ledger_journal j ON j.id = p.journal_id
        WHERE p.account_code = $1
          AND j.operating_date = $2
          AND j.reason IN ('INTRADAY_CYCLE', 'EOD_CYCLE')`,
      [accountCode, operatingDate]
    );
    return {
      totalCredits: r.rows[0].total_credits,
      totalDebits: r.rows[0].total_debits,
      cycleCount: cyclesR.rows[0].n,
      netSettled: cyclesR.rows[0].net_settled
    };
  },

  // List participant codes that have any PSET activity for the day, so we
  // know who needs a statement issued.
  participantsWithActivity: async (client, { operatingDate, currency }) => {
    const r = await client.query(
      `SELECT DISTINCT a.owner_id AS participant_code
         FROM ledger_postings p
         JOIN ledger_accounts a ON a.account_code = p.account_code
         JOIN ledger_journal j ON j.id = p.journal_id
        WHERE a.account_type = 'PARTICIPANT_SETTLEMENT'
          AND a.currency = $1
          AND j.operating_date = $2
          AND a.owner_id IS NOT NULL`,
      [currency, operatingDate]
    );
    return r.rows.map((row) => row.participant_code);
  },

  // Active currencies for a date — every currency that has at least one
  // ledger journal that day.
  activeCurrenciesForDate: async (client, operatingDate) => {
    const r = await client.query(
      `SELECT DISTINCT p.currency
         FROM ledger_postings p
         JOIN ledger_journal j ON j.id = p.journal_id
        WHERE j.operating_date = $1`,
      [operatingDate]
    );
    return r.rows.map((row) => row.currency);
  },

  // Last journal of the day — used to seal the chain hash on the
  // operating_days row.
  lastJournalForDate: async (client, operatingDate) => {
    const r = await client.query(
      `SELECT id, journal_seq, hash FROM ledger_journal
        WHERE operating_date = $1
        ORDER BY journal_seq DESC LIMIT 1`,
      [operatingDate]
    );
    return r.rows[0] || null;
  },

  insertStatement: async (
    client,
    {
      id,
      operatingDayId,
      operatingDate,
      participantCode,
      currency,
      openingPositionMinor,
      totalCreditsMinor,
      totalDebitsMinor,
      totalFeesMinor,
      cycleCount,
      netSettledMinor,
      closingPositionMinor,
      payload,
      signatureB64,
      signatureKid,
      signatureAlg
    }
  ) => {
    const r = await client.query(
      `INSERT INTO settlement_statements
         (id, operating_day_id, operating_date, participant_code, currency,
          opening_position_minor, total_credits_minor, total_debits_minor,
          total_fees_minor, cycle_count, net_settled_minor, closing_position_minor,
          payload, signature_b64, signature_kid, signature_alg)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16)
       ON CONFLICT (operating_day_id, participant_code, currency) DO NOTHING
       RETURNING ${STMT_COLS}`,
      [
        id,
        operatingDayId,
        operatingDate,
        participantCode,
        currency,
        String(openingPositionMinor),
        String(totalCreditsMinor),
        String(totalDebitsMinor),
        String(totalFeesMinor),
        cycleCount,
        String(netSettledMinor),
        String(closingPositionMinor),
        JSON.stringify(payload),
        signatureB64,
        signatureKid,
        signatureAlg
      ]
    );
    return r.rows[0] || null;
  },

  listStatementsForDate: async (client, operatingDate) => {
    const r = await client.query(
      `SELECT ${STMT_COLS} FROM settlement_statements
        WHERE operating_date = $1
        ORDER BY participant_code, currency ASC`,
      [operatingDate]
    );
    return r.rows;
  },

  findStatement: async (client, operatingDate, participantCode, currency) => {
    const r = await client.query(
      `SELECT ${STMT_COLS} FROM settlement_statements
        WHERE operating_date = $1 AND participant_code = $2 AND currency = $3
        LIMIT 1`,
      [operatingDate, participantCode, currency]
    );
    return r.rows[0] || null;
  }
});
