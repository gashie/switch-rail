import { uuidv7 } from '../../core/uuid.js';
import { config } from '../../core/config.js';
import { auditService } from '../audit/index.js';

export const createFlagsService = ({ db, model }) => {
  const flag = ({
    subjectType, subjectKey, flagType, flaggedBy,
    evidence, severity, expiresInDays
  }) =>
    db.withTransaction(async (client) => {
      const days = expiresInDays || config.fraudFlagDefaultExpiryDays;
      const expiresAt = days > 0
        ? new Date(Date.now() + days * 86_400_000).toISOString()
        : null;
      const inserted = await model.insert(client, {
        id: uuidv7(),
        subjectType,
        subjectKey,
        flagType,
        flaggedBy,
        evidence,
        severity: severity ?? 70,
        expiresAt
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'fraud_flag.raised',
        resourceType: 'fraud_flag',
        resourceId: inserted.id,
        payload: { subjectType, subjectKey, flagType, flaggedBy, severity }
      });
      return inserted;
    });

  const withdraw = ({ id, withdrawnBy }) =>
    db.withTransaction(async (client) => {
      const updated = await model.withdraw(client, { id, withdrawnBy });
      if (updated) {
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'fraud_flag.withdrawn',
          resourceType: 'fraud_flag',
          resourceId: id,
          payload: { withdrawnBy }
        });
      }
      return updated;
    });

  const listActive = (filters) =>
    db.withClient((c) => model.listActive(c, filters || { limit: 100 }));

  const findById = (id) => db.withClient((c) => model.findById(c, id));

  // Engine-facing helper: score for R011_PEER_FLAGGED. Returns max severity
  // across active flags for the given subject (account or alias).
  const lookupPeerFlagSeverity = ({ subjectType, subjectKey, client }) => {
    if (client && typeof client.query === 'function') {
      return model.maxActiveSeverity(client, { subjectType, subjectKey });
    }
    return db.withClient((c) => model.maxActiveSeverity(c, { subjectType, subjectKey }));
  };

  const expireRolloff = () => db.withTransaction((c) => model.expireRolloff(c));

  return {
    flag,
    withdraw,
    listActive,
    findById,
    lookupPeerFlagSeverity,
    expireRolloff
  };
};
