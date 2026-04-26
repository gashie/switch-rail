export const createBulkModel = () => ({
  insertBatch: async (
    client,
    { batchId, sourceFormat, originatorParticipant, total, succeeded, failed, failures }
  ) => {
    const r = await client.query(
      `INSERT INTO bulk_batches
        (batch_id, source_format, originator_participant, total, succeeded, failed, status, failures, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7::jsonb, now())
       RETURNING batch_id, source_format, originator_participant, total, succeeded, failed, status, failures, created_at, completed_at`,
      [
        batchId,
        sourceFormat,
        originatorParticipant ?? null,
        total,
        succeeded,
        failed,
        JSON.stringify(failures || [])
      ]
    );
    return r.rows[0];
  },

  getBatch: async (client, batchId) => {
    const r = await client.query(
      `SELECT batch_id, source_format, originator_participant, total, succeeded, failed, status, failures, created_at, completed_at
       FROM bulk_batches WHERE batch_id = $1 LIMIT 1`,
      [batchId]
    );
    return r.rows[0] || null;
  }
});
