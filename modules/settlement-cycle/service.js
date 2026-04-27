import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { CYCLE_TYPES } from './schema.js';

export const createCycleService = ({ db, model }) => {
  const create = ({ cycleType, currency, operatingDate, triggeredBy, triggeredReason }) =>
    db.withTransaction(async (client) => {
      if (!CYCLE_TYPES.includes(cycleType)) {
        throw new AppError('VALIDATION_FAILED', `unknown cycleType ${cycleType}`, 400);
      }
      const cycle = await model.insertCycle(client, {
        id: uuidv7(),
        cycleType,
        currency,
        operatingDate,
        triggeredBy,
        triggeredReason
      });
      await auditService.record(client, {
        actorType: triggeredBy?.startsWith('operator:') ? 'user' : 'system',
        actorId: triggeredBy?.startsWith('operator:') ? triggeredBy.slice(9) : null,
        eventType: 'cycle.created',
        resourceType: 'settlement_cycle',
        resourceId: cycle.id,
        payload: { cycleType, currency, operatingDate, triggeredReason: triggeredReason ?? null }
      });
      return cycle;
    });

  const findById = (id) =>
    db.withClient(async (c) => {
      const cycle = await model.findById(c, id);
      if (!cycle) return null;
      const movements = await model.listMovements(c, id);
      return { cycle, movements };
    });

  const list = (filters) =>
    db.withClient((c) =>
      model.listCycles(c, {
        cycleType: filters.cycleType || null,
        currency: filters.currency || null,
        operatingDate: filters.operatingDate || null,
        state: filters.state || null,
        limit: filters.limit ?? 100
      })
    );

  return { create, findById, list };
};
