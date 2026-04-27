const RECEIPT_COLS = `id, transaction_id, party, participant_code,
  receipt_payload, signature_b64, signature_kid, signature_alg, issued_at`;

export const createReceiptsModel = () => ({
  insert: async (
    client,
    { id, transactionId, party, participantCode, payload, signatureB64, signatureKid, signatureAlg = 'Ed25519' }
  ) => {
    const r = await client.query(
      `INSERT INTO transaction_receipts
         (id, transaction_id, party, participant_code, receipt_payload, signature_b64, signature_kid, signature_alg)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       ON CONFLICT (transaction_id, party) DO NOTHING
       RETURNING ${RECEIPT_COLS}`,
      [id, transactionId, party, participantCode, JSON.stringify(payload), signatureB64, signatureKid, signatureAlg]
    );
    return r.rows[0] || null;
  },

  findByTransaction: async (client, transactionId) => {
    const r = await client.query(
      `SELECT ${RECEIPT_COLS} FROM transaction_receipts
        WHERE transaction_id = $1
        ORDER BY party ASC`,
      [transactionId]
    );
    return r.rows;
  },

  findByTransactionAndParty: async (client, transactionId, party) => {
    const r = await client.query(
      `SELECT ${RECEIPT_COLS} FROM transaction_receipts
        WHERE transaction_id = $1 AND party = $2
        LIMIT 1`,
      [transactionId, party]
    );
    return r.rows[0] || null;
  },

  listForParticipant: async (client, participantCode, { limit, offset }) => {
    const rows = await client.query(
      `SELECT ${RECEIPT_COLS} FROM transaction_receipts
        WHERE participant_code = $1
        ORDER BY issued_at DESC
        LIMIT $2 OFFSET $3`,
      [participantCode, limit, offset]
    );
    const total = await client.query(
      `SELECT count(*)::bigint AS n FROM transaction_receipts WHERE participant_code = $1`,
      [participantCode]
    );
    return { rows: rows.rows, total: Number(total.rows[0].n) };
  }
});
