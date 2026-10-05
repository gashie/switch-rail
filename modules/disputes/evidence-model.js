const EVIDENCE_COLS = `id, case_id, side, uploaded_by_participant, uploaded_by_user,
  evidence_type, filename, content_sha256, content_size_bytes, mime_type,
  description, uploaded_at, rail_timestamp, rail_signature_b64,
  rail_signature_kid, prev_evidence_hash, evidence_chain_hash`;

export const createEvidenceModel = () => ({
  insert: async (
    client,
    {
      id, caseId, side, uploadedByParticipant, uploadedByUser,
      evidenceType, filename, contentSha256, contentSizeBytes, mimeType,
      description, railTimestamp, railSignatureB64, railSignatureKid,
      prevEvidenceHash, evidenceChainHash
    }
  ) => {
    const r = await client.query(
      `INSERT INTO dispute_evidence
         (id, case_id, side, uploaded_by_participant, uploaded_by_user,
          evidence_type, filename, content_sha256, content_size_bytes,
          mime_type, description, rail_timestamp, rail_signature_b64,
          rail_signature_kid, prev_evidence_hash, evidence_chain_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING ${EVIDENCE_COLS}`,
      [
        id, caseId, side, uploadedByParticipant ?? null, uploadedByUser ?? null,
        evidenceType, filename, contentSha256, contentSizeBytes,
        mimeType ?? null, description ?? null, railTimestamp, railSignatureB64,
        railSignatureKid, prevEvidenceHash, evidenceChainHash
      ]
    );
    return r.rows[0];
  },

  listForCase: async (client, { caseId, side }) => {
    const conds = ['case_id = $1'];
    const params = [caseId];
    if (side) { params.push(side); conds.push(`side = $${params.length}`); }
    const r = await client.query(
      `SELECT ${EVIDENCE_COLS} FROM dispute_evidence WHERE ${conds.join(' AND ')}
        ORDER BY uploaded_at ASC`,
      params
    );
    return r.rows;
  },

  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${EVIDENCE_COLS} FROM dispute_evidence WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  // Last evidence in the chain for the case — drives the linked-list pointer
  // for the next upload.
  lastForCase: async (client, caseId) => {
    const r = await client.query(
      `SELECT ${EVIDENCE_COLS} FROM dispute_evidence
        WHERE case_id = $1 ORDER BY uploaded_at DESC, id DESC LIMIT 1`,
      [caseId]
    );
    return r.rows[0] || null;
  },

  // For auto-progress: did each side upload at least once?
  sidesPresentForCase: async (client, caseId) => {
    const r = await client.query(
      `SELECT side, count(*)::int AS n FROM dispute_evidence
        WHERE case_id = $1 GROUP BY side`,
      [caseId]
    );
    const out = { FILER: 0, RESPONDER: 0, OPERATOR: 0 };
    for (const row of r.rows) out[row.side] = row.n;
    return out;
  }
});
