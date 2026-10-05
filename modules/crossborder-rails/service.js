import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { participantsService } from '../participants/index.js';

export const createForeignRailsService = ({ db, model }) => {
  const register = async (input) => {
    const {
      railCode, railName, railType, participantCode,
      supportedCurrencies, supportedCountries, settlementModel,
      cutoverTimeUtc, endpoints, metadata
    } = input;
    const participant = await participantsService.getByCode(participantCode);
    if (!participant) {
      throw new AppError('NOT_FOUND', `participant ${participantCode} not found`, 404);
    }
    if (participant.type !== 'FOREIGN_RAIL') {
      throw new AppError(
        'CONFLICT',
        `participant ${participantCode} is type ${participant.type}, expected FOREIGN_RAIL`,
        409
      );
    }
    return db.withTransaction(async (client) => {
      const id = uuidv7();
      const inserted = await model.insert(client, {
        id,
        railCode,
        railName,
        railType,
        participantId: participant.id,
        supportedCurrencies,
        supportedCountries,
        settlementModel,
        cutoverTimeUtc,
        endpoints,
        metadata
      });
      if (!inserted) {
        throw new AppError('CONFLICT', `foreign rail ${railCode} already registered`, 409);
      }
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'foreign_rail.registered',
        resourceType: 'foreign_rail',
        resourceId: id,
        payload: { railCode, railType, settlementModel, supportedCurrencies, supportedCountries }
      });
      return inserted;
    });
  };

  const findByCode = (code) => db.withClient((c) => model.findByCode(c, code));
  const findById = (id) => db.withClient((c) => model.findById(c, id));
  const list = (filters) => db.withClient((c) => model.list(c, filters));
  const findForCountryCurrency = (filters) =>
    db.withClient((c) => model.findForCountryCurrency(c, filters));

  const setActive = ({ railCode, active }) =>
    db.withTransaction(async (client) => {
      const r = await model.findByCode(client, railCode);
      if (!r) throw new AppError('NOT_FOUND', `foreign rail ${railCode} not found`, 404);
      const updated = await model.setActive(client, { id: r.id, active });
      await auditService.record(client, {
        actorType: 'system',
        eventType: active ? 'foreign_rail.activated' : 'foreign_rail.deactivated',
        resourceType: 'foreign_rail',
        resourceId: r.id,
        payload: { railCode }
      });
      return updated;
    });

  return { register, findByCode, findById, list, findForCountryCurrency, setActive };
};
