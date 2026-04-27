import { uuidv7 } from '../../core/uuid.js';
import { config } from '../../core/config.js';
import { directoryService } from '../directory/index.js';

const YOUNG_ACCOUNT_DAYS = 30;

const pct = (numerator, denominator) => {
  if (!denominator) return 0;
  return Math.round((numerator * 100) / denominator);
};

export const createBaselineService = ({ db, model }) => {
  const recompute = async ({ participantCode, accountNumber, currency, observationWindowDays }) =>
    db.withTransaction(async (client) => {
      // Resolve account row to get account_id and createdAt for the
      // young-account marker.
      const account = await directoryService
        .findByAccount({ participantCode, accountNumber })
        .catch(() => null);
      if (!account) return null;
      const ageDays = Math.floor((Date.now() - new Date(account.created_at).getTime()) / 86_400_000);
      const window = observationWindowDays || config.fraudBaselineWindowDays;
      const aggregates = await model.computeAggregates(client, {
        participantCode,
        accountId: account.id,
        accountNumber,
        currency,
        windowDays: window
      });

      const isYoung = ageDays < YOUNG_ACCOUNT_DAYS;
      const upsert = await model.upsert(client, {
        id: uuidv7(),
        participantCode,
        accountId: account.id,
        currency,
        computedAt: new Date().toISOString(),
        observationWindowDays: window,
        medianMinor: aggregates.medianMinor,
        p90Minor: aggregates.p90Minor,
        p99Minor: aggregates.p99Minor,
        maxObservedMinor: aggregates.maxObservedMinor,
        dailyCountMedian: aggregates.dailyCountMedian,
        dailyCountP90: aggregates.dailyCountP90,
        businessHoursPct: pct(aggregates.businessHoursCount, aggregates.total),
        weekendPct: pct(aggregates.weekendCount, aggregates.total),
        nightPct: pct(aggregates.nightCount, aggregates.total),
        distinctBeneficiaries: aggregates.distinctBeneficiaries,
        beneficiaryRepeatRate:
          aggregates.total === 0
            ? 0
            : pct(aggregates.total - aggregates.distinctBeneficiaries, aggregates.total),
        totalObservations: aggregates.total,
        metadata: {
          accountAgeDays: ageDays,
          young: isYoung,
          marker: isYoung ? 'young' : 'mature'
        }
      });
      return upsert;
    });

  const get = ({ accountId, currency }) =>
    db.withClient((c) => model.findByAccountCurrency(c, accountId, currency));

  const listForParticipant = (participantCode) =>
    db.withClient((c) => model.listForParticipant(c, participantCode));

  const refreshStaleBaselines = async ({ staleSinceHours = 24, limit = 1000 } = {}) => {
    // Worker entrypoint. Picks the accounts that had recent activity and
    // recomputes their baseline. Idempotent — running twice produces the
    // same row (last-write-wins on computed_at).
    const stale = await db.withClient((c) =>
      model.findStaleAccounts(c, { staleSinceHours, limit })
    );
    let refreshed = 0;
    for (const a of stale) {
      const r = await recompute({
        participantCode: a.participantCode,
        accountNumber: a.accountNumber,
        currency: a.currency
      });
      if (r) refreshed += 1;
    }
    return { scanned: stale.length, refreshed };
  };

  return {
    recompute,
    get,
    listForParticipant,
    refreshStaleBaselines
  };
};
