// All SQL touching ledger tables lives here. The service layer composes
// these into the postJournal pipeline; nothing else writes to the ledger.

const ACCOUNT_COLS = `id, account_code, account_type, owner_type, owner_id,
  currency, status, metadata, created_at`;

const JOURNAL_COLS = `id, journal_seq, posted_at, operating_date, reason,
  reference_type, reference_id, metadata, prev_hash, hash`;

const POSTING_COLS = `id, journal_id, posting_seq, account_code, side,
  amount_value, currency`;

export const createLedgerModel = () => ({
  insertAccount: async (
    client,
    { id, accountCode, accountType, ownerType, ownerId, currency, metadata }
  ) => {
    const r = await client.query(
      `INSERT INTO ledger_accounts
         (id, account_code, account_type, owner_type, owner_id, currency, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (account_code) DO NOTHING
       RETURNING ${ACCOUNT_COLS}`,
      [id, accountCode, accountType, ownerType, ownerId, currency, JSON.stringify(metadata || {})]
    );
    return r.rows[0] || null;
  },

  findAccountByCode: async (client, accountCode) => {
    const r = await client.query(
      `SELECT ${ACCOUNT_COLS} FROM ledger_accounts WHERE account_code = $1 LIMIT 1`,
      [accountCode]
    );
    return r.rows[0] || null;
  },

  listAccounts: async (client, { ownerType, ownerId, currency, accountType }) => {
    const conds = [];
    const params = [];
    if (ownerType) {
      params.push(ownerType);
      conds.push(`owner_type = $${params.length}`);
    }
    if (ownerId) {
      params.push(ownerId);
      conds.push(`owner_id = $${params.length}`);
    }
    if (currency) {
      params.push(currency);
      conds.push(`currency = $${params.length}`);
    }
    if (accountType) {
      params.push(accountType);
      conds.push(`account_type = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${ACCOUNT_COLS} FROM ledger_accounts ${where} ORDER BY account_code ASC`,
      params
    );
    return r.rows;
  },

  // Last journal of a given operating date — used to chain prev_hash.
  lastJournalForDate: async (client, operatingDate) => {
    const r = await client.query(
      `SELECT ${JOURNAL_COLS} FROM ledger_journal
        WHERE operating_date = $1
        ORDER BY journal_seq DESC LIMIT 1`,
      [operatingDate]
    );
    return r.rows[0] || null;
  },

  insertJournal: async (
    client,
    { id, operatingDate, reason, referenceType, referenceId, metadata, prevHash, hash }
  ) => {
    const r = await client.query(
      `INSERT INTO ledger_journal
         (id, operating_date, reason, reference_type, reference_id, metadata, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       RETURNING ${JOURNAL_COLS}`,
      [id, operatingDate, reason, referenceType ?? null, referenceId ?? null, JSON.stringify(metadata || {}), prevHash, hash]
    );
    return r.rows[0];
  },

  // Two-phase hash seal: insertJournal writes a placeholder hash, then this
  // updates the row once the canonical journal_seq is known and the chain
  // hash has been computed. Kept on the model to satisfy no-sql-in-service.
  updateJournalHash: async (client, journalId, hash) => {
    await client.query(`UPDATE ledger_journal SET hash = $2 WHERE id = $1`, [journalId, hash]);
  },

  insertPosting: async (
    client,
    { id, journalId, postingSeq, accountCode, side, amountValue, currency }
  ) => {
    const r = await client.query(
      `INSERT INTO ledger_postings
         (id, journal_id, posting_seq, account_code, side, amount_value, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${POSTING_COLS}`,
      [id, journalId, postingSeq, accountCode, side, String(amountValue), currency]
    );
    return r.rows[0];
  },

  findJournalById: async (client, id) => {
    const r = await client.query(
      `SELECT ${JOURNAL_COLS} FROM ledger_journal WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  listPostingsForJournal: async (client, journalId) => {
    const r = await client.query(
      `SELECT ${POSTING_COLS} FROM ledger_postings
        WHERE journal_id = $1
        ORDER BY posting_seq ASC`,
      [journalId]
    );
    return r.rows;
  },

  listJournalsByReference: async (client, referenceType, referenceId) => {
    const r = await client.query(
      `SELECT ${JOURNAL_COLS} FROM ledger_journal
        WHERE reference_type = $1 AND reference_id = $2
        ORDER BY journal_seq ASC`,
      [referenceType, referenceId]
    );
    return r.rows;
  },

  listJournalsForDate: async (client, operatingDate) => {
    const r = await client.query(
      `SELECT ${JOURNAL_COLS} FROM ledger_journal
        WHERE operating_date = $1
        ORDER BY journal_seq ASC`,
      [operatingDate]
    );
    return r.rows;
  },

  // Sum of (CR - DR) postings for an account up to (and including) a given
  // timestamp. Returned as a digit-string for the service layer to wrap in
  // BigInt — never as a JS Number.
  balanceForAccount: async (client, accountCode, asOf) => {
    const r = await client.query(
      `SELECT COALESCE(
                SUM(CASE WHEN side = 'CR' THEN amount_value ELSE -amount_value END),
                0
              )::text AS balance
         FROM ledger_postings p
         JOIN ledger_journal j ON j.id = p.journal_id
        WHERE p.account_code = $1
          AND ($2::timestamptz IS NULL OR j.posted_at <= $2::timestamptz)`,
      [accountCode, asOf || null]
    );
    return r.rows[0].balance;
  },

  // Per-currency DR/CR sums for the postings that share a journal id, used
  // by the postJournal balance assertion.
  sumByCurrencyForEntries: (entries) => {
    const acc = new Map();
    for (const e of entries) {
      const cur = acc.get(e.currency) || { dr: 0n, cr: 0n };
      if (e.side === 'DR') cur.dr += BigInt(e.amount);
      else cur.cr += BigInt(e.amount);
      acc.set(e.currency, cur);
    }
    return acc;
  }
});
