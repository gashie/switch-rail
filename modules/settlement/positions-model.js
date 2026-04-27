// All position-table SQL lives here. Service layer composes these into the
// applyJournalToPositions hook and the recompute path.

const POS_COLS = `id, participant_code, currency, position_minor, last_journal_id,
  last_cycle_id, updated_at`;

export const createPositionsModel = () => ({
  upsertDelta: async (
    client,
    { id, participantCode, currency, deltaMinor, lastJournalId }
  ) => {
    const r = await client.query(
      `INSERT INTO settlement_positions
         (id, participant_code, currency, position_minor, last_journal_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (participant_code, currency) DO UPDATE
         SET position_minor = settlement_positions.position_minor + EXCLUDED.position_minor,
             last_journal_id = EXCLUDED.last_journal_id,
             updated_at = now()
       RETURNING ${POS_COLS}`,
      [id, participantCode, currency, String(deltaMinor), lastJournalId]
    );
    return r.rows[0];
  },

  setPositionToZero: async (client, { participantCode, currency, lastCycleId }) => {
    const r = await client.query(
      `UPDATE settlement_positions
          SET position_minor = 0,
              last_cycle_id = $3,
              updated_at = now()
        WHERE participant_code = $1 AND currency = $2
        RETURNING ${POS_COLS}`,
      [participantCode, currency, lastCycleId]
    );
    return r.rows[0] || null;
  },

  setPositionAbsolute: async (
    client,
    { participantCode, currency, positionMinor, lastJournalId }
  ) => {
    const r = await client.query(
      `INSERT INTO settlement_positions
         (id, participant_code, currency, position_minor, last_journal_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       ON CONFLICT (participant_code, currency) DO UPDATE
         SET position_minor = EXCLUDED.position_minor,
             last_journal_id = EXCLUDED.last_journal_id,
             updated_at = now()
       RETURNING ${POS_COLS}`,
      [participantCode, currency, String(positionMinor), lastJournalId || null]
    );
    return r.rows[0];
  },

  findByParticipantCurrency: async (client, participantCode, currency) => {
    const r = await client.query(
      `SELECT ${POS_COLS} FROM settlement_positions
        WHERE participant_code = $1 AND currency = $2
        LIMIT 1`,
      [participantCode, currency]
    );
    return r.rows[0] || null;
  },

  listForParticipant: async (client, participantCode) => {
    const r = await client.query(
      `SELECT ${POS_COLS} FROM settlement_positions
        WHERE participant_code = $1
        ORDER BY currency ASC`,
      [participantCode]
    );
    return r.rows;
  },

  listAll: async (client, { currency }) => {
    if (currency) {
      const r = await client.query(
        `SELECT ${POS_COLS} FROM settlement_positions
          WHERE currency = $1
          ORDER BY participant_code ASC`,
        [currency]
      );
      return r.rows;
    }
    const r = await client.query(
      `SELECT ${POS_COLS} FROM settlement_positions
        ORDER BY participant_code, currency ASC`
    );
    return r.rows;
  },

  // Used by the journal-posted hook: pull the participant ledger postings
  // from a single journal so the service can update positions in one
  // transaction with the journal insert.
  participantPostingsForJournal: async (client, journalId) => {
    const r = await client.query(
      `SELECT p.account_code, p.side, p.amount_value, p.currency, a.owner_id AS participant_code
         FROM ledger_postings p
         JOIN ledger_accounts a ON a.account_code = p.account_code
        WHERE p.journal_id = $1
          AND a.account_type = 'PARTICIPANT_SETTLEMENT'`,
      [journalId]
    );
    return r.rows;
  },

  // Recompute helper: sum (CR - DR) over all participant settlement
  // postings since the last cycle reset for a (participant, currency).
  recomputeFromJournal: async (client, { participantCode, currency }) => {
    const accountCode = `PSET:${participantCode}:${currency}`;
    const r = await client.query(
      `SELECT COALESCE(
                SUM(CASE WHEN p.side = 'CR' THEN p.amount_value ELSE -p.amount_value END),
                0
              )::text AS net,
              MAX(p.journal_id) AS last_journal_id
         FROM ledger_postings p
         JOIN ledger_journal j ON j.id = p.journal_id
         LEFT JOIN settlement_positions sp ON sp.participant_code = $1 AND sp.currency = $2
        WHERE p.account_code = $3
          AND (sp.last_cycle_id IS NULL OR j.id != sp.last_journal_id OR j.posted_at > (
            SELECT updated_at FROM settlement_positions sp2
             WHERE sp2.participant_code = $1 AND sp2.currency = $2
          ))`,
      [participantCode, currency, accountCode]
    );
    return { net: r.rows[0].net, lastJournalId: r.rows[0].last_journal_id };
  },

  // Filter a candidate list of participant codes down to those that exist
  // in the participants table. Used by recomputeAll to skip orphaned PSET
  // accounts whose participant has been deleted.
  filterToExistingParticipants: async (client, codes) => {
    if (!codes.length) return new Set();
    const r = await client.query(
      `SELECT code FROM participants WHERE code = ANY($1)`,
      [codes]
    );
    return new Set(r.rows.map((row) => row.code));
  },

  // Simpler recompute that ignores cycle markers: for break-glass full
  // rebuild, we sum all postings ever and pick the most recent journal id
  // via journal_seq (Postgres has no MAX(uuid)).
  recomputeFullForAccount: async (client, accountCode) => {
    const sumR = await client.query(
      `SELECT COALESCE(
                SUM(CASE WHEN side = 'CR' THEN amount_value ELSE -amount_value END),
                0
              )::text AS net
         FROM ledger_postings
        WHERE account_code = $1`,
      [accountCode]
    );
    const lastR = await client.query(
      `SELECT j.id AS journal_id
         FROM ledger_postings p
         JOIN ledger_journal j ON j.id = p.journal_id
        WHERE p.account_code = $1
        ORDER BY j.journal_seq DESC
        LIMIT 1`,
      [accountCode]
    );
    return {
      net: sumR.rows[0].net,
      lastJournalId: lastR.rows[0]?.journal_id || null
    };
  }
});
