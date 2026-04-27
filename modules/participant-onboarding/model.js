const KYB_COLS =
  'id, participant_id, doc_type, doc_filename, doc_sha256, uploaded_at, uploaded_by, reviewed_at, reviewed_by, review_status, review_note';
const CERT_COLS = 'id, participant_id, test_suite, status, ran_at, result';

export const createOnboardingModel = () => ({
  upsertKybDoc: async (
    client,
    { id, participantId, docType, docFilename, docSha256, uploadedBy }
  ) => {
    const r = await client.query(
      `INSERT INTO participant_kyb
        (id, participant_id, doc_type, doc_filename, doc_sha256, uploaded_by, review_status, review_note, reviewed_at, reviewed_by)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, NULL, NULL)
       ON CONFLICT (participant_id, doc_type) DO UPDATE SET
         doc_filename = EXCLUDED.doc_filename,
         doc_sha256 = EXCLUDED.doc_sha256,
         uploaded_at = now(),
         uploaded_by = EXCLUDED.uploaded_by,
         review_status = NULL,
         review_note = NULL,
         reviewed_at = NULL,
         reviewed_by = NULL
       RETURNING ${KYB_COLS}`,
      [id, participantId, docType, docFilename, docSha256, uploadedBy ?? null]
    );
    return r.rows[0];
  },

  reviewKybDoc: async (client, { participantId, docType, status, note, reviewedBy }) => {
    const r = await client.query(
      `UPDATE participant_kyb
         SET review_status = $3, review_note = $4, reviewed_at = now(), reviewed_by = $5
       WHERE participant_id = $1 AND doc_type = $2
       RETURNING ${KYB_COLS}`,
      [participantId, docType, status, note ?? null, reviewedBy ?? null]
    );
    return r.rows[0] || null;
  },

  listKybDocs: async (client, participantId) => {
    const r = await client.query(
      `SELECT ${KYB_COLS} FROM participant_kyb WHERE participant_id = $1 ORDER BY doc_type`,
      [participantId]
    );
    return r.rows;
  },

  upsertCertResult: async (client, { id, participantId, testSuite, status, result }) => {
    const r = await client.query(
      `INSERT INTO participant_certifications (id, participant_id, test_suite, status, ran_at, result)
       VALUES ($1, $2, $3, $4, now(), $5::jsonb)
       ON CONFLICT (participant_id, test_suite) DO UPDATE SET
         status = EXCLUDED.status,
         ran_at = EXCLUDED.ran_at,
         result = EXCLUDED.result
       RETURNING ${CERT_COLS}`,
      [id, participantId, testSuite, status, JSON.stringify(result || {})]
    );
    return r.rows[0];
  },

  listCerts: async (client, participantId) => {
    const r = await client.query(
      `SELECT ${CERT_COLS} FROM participant_certifications WHERE participant_id = $1 ORDER BY test_suite`,
      [participantId]
    );
    return r.rows;
  }
});
