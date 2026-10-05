import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import {
  RULE_CODES,
  PACK_CODES,
  DEFAULT_RULE_WEIGHTS,
  DEFAULT_RULE_PARAMETERS
} from './codes.js';

const PACK_DEFINITIONS = Object.freeze({
  [PACK_CODES.UNIVERSAL_BASELINE_V1]: {
    name: 'Universal Baseline V1',
    description: 'Cross-jurisdiction fraud rules every participant ships with.',
    rules: [
      RULE_CODES.R001_HIGH_VELOCITY_1H,
      RULE_CODES.R002_HIGH_VALUE_VS_BASELINE,
      RULE_CODES.R003_NEW_BENEFICIARY_HIGH_VALUE,
      RULE_CODES.R004_STRUCTURING_PATTERN,
      RULE_CODES.R008_GEO_VELOCITY_IMPOSSIBLE,
      RULE_CODES.R009_NIGHT_OWL,
      RULE_CODES.R010_DORMANT_REACTIVATION,
      RULE_CODES.R011_PEER_FLAGGED,
      RULE_CODES.R012_SANCTIONS_HIT,
      RULE_CODES.R013_WATCHLIST_HIT,
      RULE_CODES.R014_NETWORK_GRAPH_MULE_PATH,
      RULE_CODES.R015_SUDDEN_HIGH_VALUE_SOLO
    ]
  },
  [PACK_CODES.GHANA_TYPOLOGIES_V1]: {
    name: 'Ghana Typologies V1',
    description: 'Ghana-specific fraud typologies (Sakawa, SIM swap, MoMo agent).',
    rules: [
      RULE_CODES.R005_SAKAWA_RAPID_DISPERSAL,
      RULE_CODES.R006_SIM_SWAP_VELOCITY,
      RULE_CODES.R007_MOMO_AGENT_PATTERN
    ]
  }
});

const ruleNameFor = (code) =>
  code
    .replace(/^R\d+_/, '')
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');

export const createRulesService = ({ db, model }) => {
  const seedDefaultPacks = async (createdBy = null) =>
    db.withTransaction(async (client) => {
      const out = { packs: [], rules: [] };
      for (const [code, def] of Object.entries(PACK_DEFINITIONS)) {
        const existing = await model.findPackByCode(client, code);
        const pack =
          existing ||
          (await model.insertPack(client, {
            id: uuidv7(),
            packCode: code,
            name: def.name,
            description: def.description,
            blockThreshold: 80,
            reviewThreshold: 50,
            createdBy
          }));
        out.packs.push(pack);
        for (const ruleCode of def.rules) {
          const inserted = await model.insertRule(client, {
            id: uuidv7(),
            ruleCode,
            packId: pack.id,
            name: ruleNameFor(ruleCode),
            description: ruleCode,
            weight: DEFAULT_RULE_WEIGHTS[ruleCode] ?? 50,
            parameters: DEFAULT_RULE_PARAMETERS[ruleCode] ?? {}
          });
          if (inserted) out.rules.push(inserted);
        }
      }
      return out;
    });

  const enablePackForParticipant = ({ participantCode, packCode, enabled = true }) =>
    db.withTransaction(async (client) => {
      const pack = await model.findPackByCode(client, packCode);
      if (!pack) throw new AppError('NOT_FOUND', `pack ${packCode} not found`, 404);
      return model.enablePackForParticipant(client, {
        participantCode,
        packId: pack.id,
        enabled
      });
    });

  const listPacks = () => db.withClient((c) => model.listPacks(c));

  const findPackByCode = (code) =>
    db.withClient(async (c) => {
      const pack = await model.findPackByCode(c, code);
      if (!pack) return null;
      const rules = await model.listRulesForPack(c, pack.id);
      return { pack, rules };
    });

  const findRule = (id) => db.withClient((c) => model.findRuleById(c, id));

  const proposeChange = ({ ruleId, pendingChange, proposedBy }) =>
    db.withTransaction(async (client) => {
      if (!proposedBy) {
        throw new AppError('VALIDATION_FAILED', 'proposedBy is required', 400);
      }
      const updated = await model.proposeRuleChange(client, {
        id: ruleId,
        pendingChange,
        proposedBy
      });
      if (!updated) throw new AppError('NOT_FOUND', `rule ${ruleId} not found`, 404);
      await auditService.record(client, {
        actorType: 'user',
        actorId: proposedBy,
        eventType: 'fraud.rule_change_proposed',
        resourceType: 'fraud_rule',
        resourceId: ruleId,
        payload: { pendingChange }
      });
      return updated;
    });

  const approveChange = ({ ruleId, approvedBy }) =>
    db.withTransaction(async (client) => {
      if (!approvedBy) {
        throw new AppError('VALIDATION_FAILED', 'approvedBy is required', 400);
      }
      const cur = await model.findRuleById(client, ruleId);
      if (!cur) throw new AppError('NOT_FOUND', `rule ${ruleId} not found`, 404);
      if (!cur.pending_change) {
        throw new AppError('CONFLICT', 'no pending change to approve', 409);
      }
      if (cur.proposed_by && cur.proposed_by === approvedBy) {
        throw new AppError(
          'CONFLICT',
          'maker-checker: the proposer cannot approve their own change',
          409
        );
      }
      const updated = await model.approveRuleChange(client, { id: ruleId, approvedBy });
      await auditService.record(client, {
        actorType: 'user',
        actorId: approvedBy,
        eventType: 'fraud.rule_change_approved',
        resourceType: 'fraud_rule',
        resourceId: ruleId,
        payload: {
          ruleCode: updated.rule_code,
          weight: updated.weight,
          active: updated.active
        }
      });
      return updated;
    });

  // Engine-facing helper. Returns the active rules + their pack thresholds
  // for a given originator participant. Cached per-call by the engine; no
  // caching here.
  const listActiveRulesForParticipant = (participantCode) =>
    db.withClient((c) => model.listActiveRulesForParticipant(c, participantCode));

  return {
    seedDefaultPacks,
    enablePackForParticipant,
    listPacks,
    findPackByCode,
    findRule,
    proposeChange,
    approveChange,
    listActiveRulesForParticipant
  };
};
