import { createBaseCrud } from '../../core/baseCrud.js';

const PARTICIPANT_COLUMNS = [
  'id',
  'code',
  'name',
  'legal_name',
  'type',
  'bic',
  'country_code',
  'status',
  'supported_formats',
  'endpoints',
  'contact_email',
  'contact_phone',
  'metadata',
  'certified_at',
  'activated_at',
  'suspended_at',
  'created_at',
  'updated_at'
];

const baseCrud = createBaseCrud({
  table: 'participants',
  pk: 'id',
  columns: PARTICIPANT_COLUMNS,
  insertable: [
    'code',
    'name',
    'legal_name',
    'type',
    'bic',
    'country_code',
    'status',
    'supported_formats',
    'endpoints',
    'contact_email',
    'contact_phone',
    'metadata'
  ],
  updatable: [
    'name',
    'legal_name',
    'bic',
    'country_code',
    'supported_formats',
    'endpoints',
    'contact_email',
    'contact_phone',
    'metadata',
    'status',
    'certified_at',
    'activated_at',
    'suspended_at'
  ],
  defaultOrderBy: 'created_at DESC'
});

export const createParticipantsModel = () => ({
  ...baseCrud,

  insertOnConflictReturn: async (client, row) => {
    const r = await client.query(
      `INSERT INTO participants (
        id, code, name, legal_name, type, bic, country_code, status,
        supported_formats, endpoints, contact_email, contact_phone, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10::jsonb, $11, $12, $13::jsonb
      )
      ON CONFLICT (code) DO NOTHING
      RETURNING ${PARTICIPANT_COLUMNS.join(', ')}`,
      [
        row.id,
        row.code,
        row.name,
        row.legal_name,
        row.type,
        row.bic ?? null,
        row.country_code,
        row.status,
        row.supported_formats,
        JSON.stringify(row.endpoints ?? {}),
        row.contact_email ?? null,
        row.contact_phone ?? null,
        JSON.stringify(row.metadata ?? {})
      ]
    );
    return r.rows[0] || null;
  },

  findByCode: async (client, code) => {
    const r = await client.query(
      `SELECT ${PARTICIPANT_COLUMNS.join(', ')} FROM participants WHERE code = $1 LIMIT 1`,
      [code]
    );
    return r.rows[0] || null;
  },

  findCodeByBic: async (client, bic) => {
    const r = await client.query(
      `SELECT code FROM participants WHERE bic = $1 LIMIT 1`,
      [String(bic).toUpperCase()]
    );
    return r.rows[0]?.code || null;
  },

  updateByCode: async (client, code, data) => {
    const keys = Object.keys(data);
    if (keys.length === 0) {
      return await (async () => {
        const r = await client.query(
          `SELECT ${PARTICIPANT_COLUMNS.join(', ')} FROM participants WHERE code = $1 LIMIT 1`,
          [code]
        );
        return r.rows[0] || null;
      })();
    }
    const setParts = keys.map((k, i) => `${k} = $${i + 1}`);
    setParts.push('updated_at = now()');
    const params = [...keys.map((k) => data[k]), code];
    const sql = `UPDATE participants SET ${setParts.join(', ')} WHERE code = $${params.length} RETURNING ${PARTICIPANT_COLUMNS.join(', ')}`;
    const r = await client.query(sql, params);
    return r.rows[0] || null;
  }
});

export { PARTICIPANT_COLUMNS };
