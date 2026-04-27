import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { canonicalJsonBytes } from '../../core/json.js';
import { auditService } from '../audit/index.js';
import { cryptoKeysService } from '../crypto-keys/index.js';
import {
  settlementCycleService,
  settlementCycleRunner
} from '../settlement-cycle/index.js';
import { issueStatement } from './statement-generator.js';

const nextDateUtc = (yyyyMmDd) => {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
};

// Function-signature rule enforcement: the confirmation token is required
// and validated at the call site. There is no zero-arg "accidentally roll
// the day" path.
export const createCutover = ({ db, model }) =>
  async ({ operatingDate, confirmation }) => {
    if (!confirmation || typeof confirmation !== 'string' || confirmation.length < 4) {
      throw new AppError(
        'VALIDATION_FAILED',
        'eod.cutover requires a confirmation token (≥ 4 chars)',
        400
      );
    }
    return db.withTransaction(async (client) => {
      const day = await model.findByDateForUpdate(client, operatingDate);
      if (!day) {
        throw new AppError('NOT_FOUND', `operating day ${operatingDate} not found`, 404);
      }
      if (day.state === 'CLOSED') {
        throw new AppError(
          'CONFLICT',
          `operating day ${operatingDate} is already CLOSED`,
          409
        );
      }
      if (day.state !== 'OPEN') {
        throw new AppError(
          'CONFLICT',
          `operating day ${operatingDate} is in state ${day.state}, expected OPEN`,
          409
        );
      }

      // 1. Mark the day CLOSING.
      const closing = await model.setDayState(client, {
        id: day.id,
        state: 'CLOSING',
        fields: { cutover_at: new Date().toISOString() }
      });

      // 2. Run an EOD cycle for every active currency. Cycles are idempotent
      //    so this is safe to retry. Each cycle drains positions to zero
      //    and writes its own RTGS file.
      const currencies = await model.activeCurrenciesForDate(client, operatingDate);
      const cycleSummaries = [];
      for (const ccy of currencies) {
        const created = await settlementCycleService.create({
          cycleType: 'END_OF_DAY',
          currency: ccy,
          operatingDate,
          triggeredBy: 'eod-worker',
          triggeredReason: `EOD cutover for ${operatingDate}`
        });
        const ran = await settlementCycleRunner.runCycle(created.id, {
          confirmation: `eod-${operatingDate}-${ccy}`
        });
        cycleSummaries.push({ id: created.id, currency: ccy, movements: ran.movements.length });
      }

      // 3. Issue a signed statement per (participant, currency) with
      //    activity. The statement payload, signature, and DB row commit
      //    in this same transaction.
      const issued = [];
      for (const ccy of currencies) {
        const codes = await model.participantsWithActivity(client, {
          operatingDate,
          currency: ccy
        });
        for (const participantCode of codes) {
          const agg = await model.participantDayAggregates(client, {
            participantCode,
            currency: ccy,
            operatingDate
          });
          // Opening position is 0 because positions reset at the previous
          // EOD; net_settled covers all cycle moves; closing position is 0
          // post-EOD-cycle.
          const stmt = await issueStatement(client, {
            model,
            operatingDay: closing,
            participantCode,
            currency: ccy,
            openingPositionMinor: 0n,
            totalCreditsMinor: agg.totalCredits,
            totalDebitsMinor: agg.totalDebits,
            totalFeesMinor: 0n, // Phase 5 wires fees in B5.7 — kept 0 here
            cycleCount: agg.cycleCount,
            netSettledMinor: agg.netSettled,
            closingPositionMinor: 0n
          });
          issued.push({ statementId: stmt.id, participantCode, currency: ccy });
        }
      }

      // 4. Freeze: capture the last journal_seq + chain hash of the day.
      const lastJ = await model.lastJournalForDate(client, operatingDate);

      // 5. Open the next operating day.
      const next = nextDateUtc(operatingDate);
      const nextDay = await model.ensureOpenDay(client, {
        id: uuidv7(),
        operatingDate: next
      });

      // 6. Close the current day.
      const closed = await model.setDayState(client, {
        id: day.id,
        state: 'CLOSED',
        fields: {
          closed_at: new Date().toISOString(),
          closing_journal_seq: lastJ?.journal_seq ?? null,
          closing_chain_hash: lastJ?.hash ?? null
        }
      });

      // BIGSERIAL columns come back as BigInt — JSON.stringify can't handle
      // those, so coerce to string for the audit payload.
      const closingSeq = lastJ?.journal_seq != null ? String(lastJ.journal_seq) : null;
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'eod.completed',
        resourceType: 'operating_day',
        resourceId: day.id,
        payload: {
          operatingDate,
          cycleCount: cycleSummaries.length,
          statementsIssued: issued.length,
          closingJournalSeq: closingSeq,
          closingChainHash: lastJ?.hash ?? null,
          nextDay: next
        }
      });

      // Hint to the cryptoKeys service so verifiers can find the kid that
      // signed the statements without guessing.
      void cryptoKeysService;
      void canonicalJsonBytes;

      return {
        day: closed,
        nextDay,
        cycles: cycleSummaries,
        statements: issued
      };
    });
  };
