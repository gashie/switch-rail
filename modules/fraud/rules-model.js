// All SQL touching fraud_rule_packs / fraud_rules / fraud_participant_rule_packs
// lives here. The rules-service composes these into the maker-checker flow,
// pack listing, and the engine's "load enabled rules for participant" query.

const PACK_COLS = `id, pack_code, name, description, block_threshold,
  review_threshold, active, created_by, created_at`;

const RULE_COLS = `id, rule_code, pack_id, name, description, weight,
  parameters, active, effective_from, effective_to,
  pending_change, proposed_by, proposed_at, approved_by, approved_at,
  created_at, updated_at`;

export const createRulesModel = () => ({
  insertPack: async (
    client,
    { id, packCode, name, description, blockThreshold, reviewThreshold, createdBy }
  ) => {
    const r = await client.query(
      `INSERT INTO fraud_rule_packs
         (id, pack_code, name, description, block_threshold, review_threshold, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (pack_code) DO NOTHING
       RETURNING ${PACK_COLS}`,
      [id, packCode, name, description ?? null, blockThreshold, reviewThreshold, createdBy ?? null]
    );
    return r.rows[0] || null;
  },

  findPackByCode: async (client, packCode) => {
    const r = await client.query(
      `SELECT ${PACK_COLS} FROM fraud_rule_packs WHERE pack_code = $1 LIMIT 1`,
      [packCode]
    );
    return r.rows[0] || null;
  },

  findPackById: async (client, id) => {
    const r = await client.query(
      `SELECT ${PACK_COLS} FROM fraud_rule_packs WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  listPacks: async (client) => {
    const r = await client.query(`SELECT ${PACK_COLS} FROM fraud_rule_packs ORDER BY pack_code ASC`);
    return r.rows;
  },

  insertRule: async (
    client,
    { id, ruleCode, packId, name, description, weight, parameters }
  ) => {
    const r = await client.query(
      `INSERT INTO fraud_rules
         (id, rule_code, pack_id, name, description, weight, parameters)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (rule_code) DO NOTHING
       RETURNING ${RULE_COLS}`,
      [id, ruleCode, packId, name, description ?? null, weight, JSON.stringify(parameters || {})]
    );
    return r.rows[0] || null;
  },

  findRuleById: async (client, id) => {
    const r = await client.query(
      `SELECT ${RULE_COLS} FROM fraud_rules WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  listRulesForPack: async (client, packId) => {
    const r = await client.query(
      `SELECT ${RULE_COLS} FROM fraud_rules WHERE pack_id = $1 ORDER BY rule_code ASC`,
      [packId]
    );
    return r.rows;
  },

  // Rules enabled for a participant: every rule in every pack that is
  // active at both the pack and the participant-rule-pack level.
  listActiveRulesForParticipant: async (client, participantCode) => {
    const r = await client.query(
      `SELECT r.*, p.block_threshold, p.review_threshold, p.pack_code
         FROM fraud_rules r
         JOIN fraud_rule_packs p ON p.id = r.pack_id
         JOIN fraud_participant_rule_packs link ON link.pack_id = p.id
        WHERE link.participant_code = $1
          AND link.enabled = true
          AND p.active = true
          AND r.active = true
        ORDER BY r.rule_code ASC`,
      [participantCode]
    );
    return r.rows;
  },

  // Maker-checker rule update — set pending_change + proposed_by/at.
  proposeRuleChange: async (client, { id, pendingChange, proposedBy }) => {
    const r = await client.query(
      `UPDATE fraud_rules
          SET pending_change = $2::jsonb,
              proposed_by = $3,
              proposed_at = now(),
              approved_by = NULL,
              approved_at = NULL,
              updated_at = now()
        WHERE id = $1
        RETURNING ${RULE_COLS}`,
      [id, JSON.stringify(pendingChange), proposedBy]
    );
    return r.rows[0] || null;
  },

  approveRuleChange: async (client, { id, approvedBy }) => {
    // Apply the pending_change object's known fields and clear the
    // pending state. We expand only the columns we know about so a
    // malicious proposer can't slip in arbitrary column writes.
    const cur = await client.query(
      `SELECT pending_change, proposed_by FROM fraud_rules WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!cur.rows[0]) return null;
    const pending = cur.rows[0].pending_change || {};
    const sets = ['pending_change = NULL', 'proposed_by = NULL', 'proposed_at = NULL', 'updated_at = now()'];
    const params = [id];
    if (pending.weight !== undefined) {
      params.push(pending.weight);
      sets.push(`weight = $${params.length}`);
    }
    if (pending.active !== undefined) {
      params.push(pending.active);
      sets.push(`active = $${params.length}`);
    }
    if (pending.parameters !== undefined) {
      params.push(JSON.stringify(pending.parameters));
      sets.push(`parameters = $${params.length}::jsonb`);
    }
    params.push(approvedBy);
    sets.push(`approved_by = $${params.length}`);
    sets.push(`approved_at = now()`);
    const r = await client.query(
      `UPDATE fraud_rules SET ${sets.join(', ')} WHERE id = $1 RETURNING ${RULE_COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  enablePackForParticipant: async (client, { participantCode, packId, enabled }) => {
    const r = await client.query(
      `INSERT INTO fraud_participant_rule_packs (participant_code, pack_id, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (participant_code, pack_id) DO UPDATE
         SET enabled = EXCLUDED.enabled, updated_at = now()
       RETURNING participant_code, pack_id, enabled, updated_at`,
      [participantCode, packId, enabled]
    );
    return r.rows[0];
  }
});
