const INCIDENT_COLS = `id, scope, severity, title, description, state,
  declared_at, resolved_at, declared_by, metadata`;

const UPDATE_COLS = `id, incident_id, body, posted_by, posted_at`;

export const createPublicStatusModel = () => ({
  insertIncident: async (client, { id, scope, severity, title, description, declaredBy, metadata }) => {
    const r = await client.query(
      `INSERT INTO status_incidents (id, scope, severity, title, description, declared_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${INCIDENT_COLS}`,
      [id, scope, severity, title, description || null, declaredBy, metadata || {}]
    );
    return r.rows[0];
  },

  insertUpdate: async (client, { id, incidentId, body, postedBy }) => {
    const r = await client.query(
      `INSERT INTO status_incident_updates (id, incident_id, body, posted_by)
       VALUES ($1, $2, $3, $4)
       RETURNING ${UPDATE_COLS}`,
      [id, incidentId, body, postedBy]
    );
    return r.rows[0];
  },

  resolve: async (client, { id, closingNote, postedBy, updateId }) => {
    await client.query(
      `INSERT INTO status_incident_updates (id, incident_id, body, posted_by) VALUES ($1, $2, $3, $4)`,
      [updateId, id, closingNote, postedBy]
    );
    const r = await client.query(
      `UPDATE status_incidents
          SET state = 'RESOLVED', resolved_at = now()
        WHERE id = $1 AND state <> 'RESOLVED'
        RETURNING ${INCIDENT_COLS}`,
      [id]
    );
    return r.rows[0];
  },

  listOpen: async (client) => {
    const r = await client.query(
      `SELECT ${INCIDENT_COLS} FROM status_incidents
        WHERE state = 'OPEN'
        ORDER BY declared_at DESC`
    );
    return r.rows;
  },

  listRecent: async (client, { limit = 20 }) => {
    const r = await client.query(
      `SELECT ${INCIDENT_COLS} FROM status_incidents
        ORDER BY declared_at DESC LIMIT $1`,
      [limit]
    );
    return r.rows;
  },

  listUpdates: async (client, { incidentId }) => {
    const r = await client.query(
      `SELECT ${UPDATE_COLS} FROM status_incident_updates
        WHERE incident_id = $1
        ORDER BY posted_at`,
      [incidentId]
    );
    return r.rows;
  },

  // Public receipt verification: returns a redacted summary that proves a
  // transaction id resolved to a confirmed payment, without leaking PII.
  verifyReceipt: async (client, { transactionId }) => {
    const r = await client.query(
      `SELECT id, state, amount_value, amount_currency,
              originator_participant, beneficiary_participant,
              confirmed_at, response_code, reason_code
         FROM transactions
        WHERE id = $1`,
      [transactionId]
    );
    if (!r.rows.length) return { found: false };
    const tx = r.rows[0];
    return {
      found: true,
      transactionId: tx.id,
      state: tx.state,
      confirmed: tx.state === 'CONFIRMED',
      confirmedAt: tx.confirmed_at,
      amountMinor: tx.amount_value,
      currency: tx.amount_currency,
      originatorParticipant: tx.originator_participant,
      beneficiaryParticipant: tx.beneficiary_participant,
      responseCode: tx.response_code,
      reasonCode: tx.reason_code
    };
  }
});
