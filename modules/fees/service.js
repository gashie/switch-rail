import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { calculateFromSchedule } from './calculator.js';

export const createFeesService = ({ db, model }) => {
  const publishSchedule = (input) =>
    db.withTransaction(async (client) => {
      // Schedule rollover is atomic: expire previous active schedules in
      // the same (railClass, currency) before inserting the new one. This
      // guarantees no two schedules can be active simultaneously for a
      // given pair.
      await model.expireExistingSchedules(client, {
        railClass: input.railClass,
        currency: input.currency
      });
      const row = await model.insertSchedule(client, {
        id: uuidv7(),
        scheduleCode: input.scheduleCode,
        railClass: input.railClass,
        currency: input.currency,
        feeType: input.feeType,
        flatMinor: input.flatMinor,
        pctBps: input.pctBps,
        tiers: input.tiers,
        minFeeMinor: input.minFeeMinor ?? '0',
        maxFeeMinor: input.maxFeeMinor,
        bearer: input.bearer || 'DEBT',
        effectiveFrom: input.effectiveFrom || new Date().toISOString(),
        createdBy: input.createdBy
      });
      await auditService.record(client, {
        actorType: input.createdBy ? 'user' : 'system',
        actorId: input.createdBy || null,
        eventType: 'fees.schedule_published',
        resourceType: 'fee_schedule',
        resourceId: row.id,
        payload: {
          scheduleCode: row.schedule_code,
          railClass: row.rail_class,
          currency: row.currency,
          feeType: row.fee_type
        }
      });
      return row;
    });

  // calculateFee runs against the current active schedule. Caller is
  // typically the orchestrator at AUTHORIZED.
  const calculateFee = async ({ railClass, currency, amountMinor, asOf, client }) => {
    const runReader = async (c) => {
      const schedule = await model.findActiveSchedule(c, { railClass, currency, asOf });
      const { feeMinor, breakdown } = calculateFromSchedule(schedule, amountMinor);
      return {
        feeMinor: feeMinor.toString(),
        scheduleId: schedule?.id ?? null,
        scheduleCode: schedule?.schedule_code ?? null,
        breakdown
      };
    };
    if (client && typeof client.query === 'function') return runReader(client);
    return db.withClient(runReader);
  };

  const listSchedules = (filters) =>
    db.withClient((c) =>
      model.listSchedules(c, {
        railClass: filters.railClass || null,
        currency: filters.currency || null,
        active: filters.active != null ? filters.active : null
      })
    );

  const findByCode = (code) => db.withClient((c) => model.findByCode(c, code));

  const summary = ({ participantCode, since, until }) => {
    if (!participantCode || !since || !until) {
      throw new AppError('VALIDATION_FAILED', 'participantCode, since, until required', 400);
    }
    return db.withClient((c) =>
      model.feeSummaryForRange(c, { participantCode, since, until })
    );
  };

  return {
    publishSchedule,
    calculateFee,
    listSchedules,
    findByCode,
    summary
  };
};
