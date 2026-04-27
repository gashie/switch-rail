import { uuidv7 } from '../../core/uuid.js';
import { canonicalJsonBytes } from '../../core/json.js';
import { AppError } from '../../core/errors.js';
import { auditService } from '../audit/index.js';
import { cryptoKeysService } from '../crypto-keys/index.js';
import { createCutover } from './cutover.js';

export const createEodService = ({ db, model }) => {
  const cutover = createCutover({ db, model });

  const ensureToday = async () =>
    db.withTransaction(async (client) => {
      const today = new Date().toISOString().slice(0, 10);
      const existing = await model.findByDate(client, today);
      if (existing) return existing;
      const created = await model.ensureOpenDay(client, {
        id: uuidv7(),
        operatingDate: today
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'eod.day_opened',
        resourceType: 'operating_day',
        resourceId: created.id,
        payload: { operatingDate: today }
      });
      return created;
    });

  const getDay = (operatingDate) =>
    db.withClient(async (c) => {
      const day = await model.findByDate(c, operatingDate);
      if (!day) return null;
      const statements = await model.listStatementsForDate(c, operatingDate);
      return { day, statements };
    });

  const listDays = ({ limit } = {}) =>
    db.withClient((c) => model.listDays(c, { limit: limit ?? 50 }));

  const listStatements = (operatingDate) =>
    db.withClient((c) => model.listStatementsForDate(c, operatingDate));

  const findStatement = (operatingDate, participantCode, currency) =>
    db.withClient((c) => model.findStatement(c, operatingDate, participantCode, currency));

  const verify = async ({ payload, signature, kid }) => {
    if (!payload || typeof payload !== 'object') {
      return { valid: false, reason: 'payload must be an object' };
    }
    if (!signature || !kid) {
      return { valid: false, reason: 'signature and kid required' };
    }
    const valid = await cryptoKeysService.verify({
      kid,
      payload: canonicalJsonBytes(payload),
      signature
    });
    return { valid, kid };
  };

  return {
    ensureToday,
    cutover,
    getDay,
    listDays,
    listStatements,
    findStatement,
    verify
  };
};

export { AppError };
