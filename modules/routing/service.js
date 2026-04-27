import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import * as cache from './cache.js';

const ensureCacheLoaded = async (db, model) => {
  if (cache.getVersion() === 0) {
    const rules = await db.withClient((c) => model.loadAllActive(c));
    cache.replaceWith(rules);
  }
};

export const createRoutingService = ({ db, model }) => ({
  reload: async () => {
    const rules = await db.withClient((c) => model.loadAllActive(c));
    cache.replaceWith(rules);
    return cache.stats();
  },

  addRule: ({ ruleType, pattern, participantCode, priority, notes }) =>
    db.withTransaction(async (client) => {
      const id = uuidv7();
      const row = await model.insertRule(client, {
        id,
        ruleType,
        pattern,
        participantCode,
        priority,
        notes
      });
      // Reload cache from DB so subsequent resolve calls see this rule.
      const rules = await model.loadAllActive(client);
      cache.replaceWith(rules);
      await auditService.record(client, {
        actorType: 'user',
        eventType: 'routing.rule.added',
        resourceType: 'routing_rule',
        resourceId: row.id,
        payload: { ruleType, pattern, participantCode, priority }
      });
      return { rule: row, version: cache.getVersion() };
    }),

  removeRule: (id) =>
    db.withTransaction(async (client) => {
      const removed = await model.removeRule(client, id);
      if (!removed) throw new AppError('NOT_FOUND', `routing rule ${id} not found`, 404);
      const rules = await model.loadAllActive(client);
      cache.replaceWith(rules);
      await auditService.record(client, {
        actorType: 'user',
        eventType: 'routing.rule.removed',
        resourceType: 'routing_rule',
        resourceId: id,
        payload: { ruleType: removed.rule_type, pattern: removed.pattern }
      });
      return { removed: true, version: cache.getVersion() };
    }),

  listRules: (input) => db.withClient((c) => model.list(c, input || {})),

  resolve: async ({ accountNumber, msisdn, bic, participantCode }) => {
    if (participantCode) {
      return {
        participantCode,
        ruleType: 'PARTICIPANT_CODE',
        ruleId: null,
        version: cache.getVersion()
      };
    }
    await ensureCacheLoaded(db, model);
    if (bic) {
      const r = cache.lookupExact('BIC', String(bic).toUpperCase());
      if (r) {
        return {
          participantCode: r.participant_code,
          ruleType: 'BIC',
          ruleId: r.id,
          version: cache.getVersion()
        };
      }
    }
    if (accountNumber) {
      const r = cache.lookupLongestPrefix('BIN', String(accountNumber));
      if (r) {
        return {
          participantCode: r.participant_code,
          ruleType: 'BIN',
          ruleId: r.id,
          version: cache.getVersion()
        };
      }
    }
    if (msisdn) {
      const stripped = String(msisdn).replace(/^\+/, '');
      const r = cache.lookupLongestPrefix('MSISDN_PREFIX', stripped);
      if (r) {
        return {
          participantCode: r.participant_code,
          ruleType: 'MSISDN_PREFIX',
          ruleId: r.id,
          version: cache.getVersion()
        };
      }
    }
    return null;
  },

  stats: () => cache.stats()
});
