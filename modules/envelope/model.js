const ENVELOPE_COLS = `envelope_id, msg_version, msg_type, created_at, source_format,
  source_message_id, end_to_end_id, idempotency_key,
  originator_participant, originator_account, originator_country,
  beneficiary_participant, beneficiary_account, beneficiary_country,
  amount_value, amount_currency,
  fee_value, fee_currency, fee_bearer,
  reference, remittance, purpose_code, settlement_method, settlement_date,
  envelope, signature`;

const toRow = (env) => ({
  envelope_id: env.envelopeId,
  msg_version: env.msgVersion,
  msg_type: env.msgType,
  created_at: env.createdAt,
  source_format: env.sourceFormat,
  source_message_id: env.sourceMessageId ?? null,
  end_to_end_id: env.endToEndId,
  idempotency_key: env.idempotencyKey,
  originator_participant: env.originator.participantCode,
  originator_account: env.originator.accountId,
  originator_country: env.originator.countryCode ?? null,
  beneficiary_participant: env.beneficiary.participantCode,
  beneficiary_account: env.beneficiary.accountId,
  beneficiary_country: env.beneficiary.countryCode ?? null,
  amount_value: env.amount.value,
  amount_currency: env.amount.currency,
  fee_value: env.fee ? env.fee.value : null,
  fee_currency: env.fee ? env.fee.currency : null,
  fee_bearer: env.fee ? env.fee.bearer : null,
  reference: env.reference ?? null,
  remittance: env.remittance ?? null,
  purpose_code: env.purposeCode ?? null,
  settlement_method: env.settlementMethod ?? null,
  settlement_date: env.settlementDate ?? null,
  envelope: JSON.stringify(env),
  signature: env.signature ? JSON.stringify(env.signature) : null
});

export const createEnvelopeModel = () => ({
  insertIfAbsent: async (client, env) => {
    const row = toRow(env);
    const r = await client.query(
      `INSERT INTO envelopes (
        envelope_id, msg_version, msg_type, created_at, source_format,
        source_message_id, end_to_end_id, idempotency_key,
        originator_participant, originator_account, originator_country,
        beneficiary_participant, beneficiary_account, beneficiary_country,
        amount_value, amount_currency,
        fee_value, fee_currency, fee_bearer,
        reference, remittance, purpose_code, settlement_method, settlement_date,
        envelope, signature
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11,
        $12, $13, $14,
        $15, $16,
        $17, $18, $19,
        $20, $21, $22, $23, $24,
        $25::jsonb, $26::jsonb
      )
      ON CONFLICT (originator_participant, idempotency_key) DO NOTHING
      RETURNING envelope`,
      [
        row.envelope_id,
        row.msg_version,
        row.msg_type,
        row.created_at,
        row.source_format,
        row.source_message_id,
        row.end_to_end_id,
        row.idempotency_key,
        row.originator_participant,
        row.originator_account,
        row.originator_country,
        row.beneficiary_participant,
        row.beneficiary_account,
        row.beneficiary_country,
        row.amount_value,
        row.amount_currency,
        row.fee_value,
        row.fee_currency,
        row.fee_bearer,
        row.reference,
        row.remittance,
        row.purpose_code,
        row.settlement_method,
        row.settlement_date,
        row.envelope,
        row.signature
      ]
    );
    if (r.rowCount === 0) return { row: null, inserted: false };
    return { row: r.rows[0].envelope, inserted: true };
  },

  findByIdempotencyKey: async (client, participantCode, idempotencyKey) => {
    const r = await client.query(
      `SELECT envelope FROM envelopes
        WHERE originator_participant = $1 AND idempotency_key = $2
        LIMIT 1`,
      [participantCode, idempotencyKey]
    );
    return r.rows[0]?.envelope || null;
  },

  findByEnvelopeId: async (client, envelopeId) => {
    const r = await client.query(
      `SELECT envelope FROM envelopes WHERE envelope_id = $1 LIMIT 1`,
      [envelopeId]
    );
    return r.rows[0]?.envelope || null;
  },

  list: async (client, { limit = 50, offset = 0 } = {}) => {
    const rowsR = await client.query(
      `SELECT envelope FROM envelopes ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const totalR = await client.query(`SELECT count(*)::bigint AS total FROM envelopes`);
    return { rows: rowsR.rows.map((r) => r.envelope), total: Number(totalR.rows[0].total) };
  }
});

export const ENVELOPE_TABLE_COLUMNS = ENVELOPE_COLS;
