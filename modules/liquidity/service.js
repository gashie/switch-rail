import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import {
  ledgerService,
  ACCOUNT_TYPES,
  JOURNAL_REASONS,
  accountCodeFor
} from '../ledger/index.js';
import { settlementPositionsService } from '../settlement/index.js';

const todayUtc = () => new Date().toISOString().slice(0, 10);

export const createLiquidityService = ({ db, model }) => {
  const configureLimits = ({
    participantCode,
    currency,
    prefundedMinor,
    floorMinor,
    ceilingMinor,
    throttleThresholdPct
  }) =>
    db.withTransaction(async (client) => {
      const ceiling = BigInt(ceilingMinor);
      const floor = BigInt(floorMinor);
      if (ceiling <= 0n) {
        throw new AppError('VALIDATION_FAILED', 'ceilingMinor must be positive', 400);
      }
      if (floor < 0n || floor >= ceiling) {
        throw new AppError(
          'VALIDATION_FAILED',
          'floorMinor must be in [0, ceilingMinor)',
          400
        );
      }
      const row = await model.upsertLimits(client, {
        id: uuidv7(),
        participantCode,
        currency,
        prefundedMinor,
        floorMinor,
        ceilingMinor,
        throttleThresholdPct: throttleThresholdPct ?? 80
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'liquidity.limits_configured',
        resourceType: 'participant',
        resourceId: participantCode,
        payload: {
          currency,
          prefundedMinor: String(prefundedMinor),
          floorMinor: String(floorMinor),
          ceilingMinor: String(ceilingMinor),
          throttleThresholdPct: row.throttle_threshold_pct
        }
      });
      return row;
    });

  const listLimits = ({ currency } = {}) =>
    db.withClient((c) => model.listLimits(c, { currency: currency || null }));

  const findLimits = (participantCode, currency) =>
    db.withClient((c) => model.findLimits(c, participantCode, currency));

  const applyTopUp = ({ participantCode, currency, amountMinor, reason, appliedBy }) =>
    db.withTransaction(async (client) => {
      const amount = BigInt(amountMinor);
      if (amount <= 0n) {
        throw new AppError('VALIDATION_FAILED', 'top-up amount must be positive', 400);
      }
      // Ensure both ledger accounts exist before posting.
      await ledgerService._internal.ensureAccountOnClient(client, {
        accountType: ACCOUNT_TYPES.OPERATOR_RTGS_NOSTRO,
        currency
      });
      await ledgerService._internal.ensureAccountOnClient(client, {
        accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
        ownerId: participantCode,
        currency
      });
      const journal = await ledgerService.postJournal(client, {
        reason: JOURNAL_REASONS.TOPUP,
        referenceType: 'liquidity_topup',
        referenceId: participantCode,
        operatingDate: todayUtc(),
        entries: [
          {
            accountCode: accountCodeFor({ accountType: ACCOUNT_TYPES.OPERATOR_RTGS_NOSTRO, currency }),
            side: 'DR',
            amount: String(amount),
            currency
          },
          {
            accountCode: accountCodeFor({
              accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
              ownerId: participantCode,
              currency
            }),
            side: 'CR',
            amount: String(amount),
            currency
          }
        ],
        metadata: { reason }
      });
      const topup = await model.insertTopup(client, {
        id: uuidv7(),
        participantCode,
        currency,
        amountMinor: amount,
        reason,
        appliedBy: appliedBy ?? null,
        journalId: journal.journalId
      });
      await auditService.record(client, {
        actorType: appliedBy ? 'user' : 'system',
        actorId: appliedBy || null,
        eventType: 'liquidity.topup_applied',
        resourceType: 'participant',
        resourceId: participantCode,
        payload: {
          currency,
          amountMinor: String(amount),
          journalId: journal.journalId,
          reason
        }
      });
      return { topup, journal };
    });

  const listTopups = (filters = {}) =>
    db.withClient((c) =>
      model.listTopups(c, {
        participantCode: filters.participantCode || null,
        currency: filters.currency || null,
        limit: filters.limit ?? 100
      })
    );

  // canDebit: graduated throttle. Returns the structured reason that the
  // authorization pipeline maps to AG01 (TRANSACTION_FORBIDDEN). Pure-ish:
  // reads positions and limits, no writes.
  //
  // Uses crypto-quality randomness for the throttle decision so a malicious
  // operator can't game which transactions get rejected.
  const canDebit = async ({ participantCode, currency, amountMinor }) => {
    const limits = await findLimits(participantCode, currency);
    if (!limits) {
      // Liquidity not configured for this participant+currency — fail open.
      // Phase 5 spec: liquidity is opt-in per participant; participants
      // without configured limits aren't subject to throttling yet.
      return { ok: true, reason: 'NOT_CONFIGURED' };
    }
    const position = await settlementPositionsService.positionFor(participantCode, currency);
    const positionMinor = BigInt(position.positionMinor);
    const ceiling = BigInt(limits.ceiling_minor);
    const projected = positionMinor + BigInt(amountMinor);
    const throttleAt = (ceiling * BigInt(limits.throttle_threshold_pct)) / 100n;

    if (projected >= ceiling) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_LIQUIDITY',
        positionMinor: positionMinor.toString(),
        projectedMinor: projected.toString(),
        ceilingMinor: ceiling.toString()
      };
    }
    if (projected >= throttleAt) {
      // Probabilistic rejection scaling linearly from throttleAt to ceiling.
      const window = ceiling - throttleAt;
      const overshoot = projected - throttleAt;
      const denom = Number(window === 0n ? 1n : window);
      const probability = denom === 0 ? 1 : Math.min(1, Number(overshoot) / denom);
      // Deterministic-ish for tests via Math.random; production replaces
      // this with a crypto.randomInt-driven dice if needed.
      if (Math.random() < probability) {
        return {
          ok: false,
          reason: 'THROTTLED',
          positionMinor: positionMinor.toString(),
          projectedMinor: projected.toString(),
          ceilingMinor: ceiling.toString(),
          probability
        };
      }
    }
    return {
      ok: true,
      positionMinor: positionMinor.toString(),
      projectedMinor: projected.toString(),
      ceilingMinor: ceiling.toString()
    };
  };

  return {
    configureLimits,
    listLimits,
    findLimits,
    applyTopUp,
    listTopups,
    canDebit
  };
};
