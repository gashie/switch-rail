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
import { writeRtgsCsv } from './rtgs-output.js';

const journalReasonForCycle = (cycleType) => {
  switch (cycleType) {
    case 'INTRADAY_NET':
      return JOURNAL_REASONS.INTRADAY_CYCLE;
    case 'END_OF_DAY':
      return JOURNAL_REASONS.EOD_CYCLE;
    case 'RTGS_GROSS':
      return JOURNAL_REASONS.RTGS_GROSS;
    case 'EXCEPTION':
      return JOURNAL_REASONS.EXCEPTION;
    default:
      throw new AppError('VALIDATION_FAILED', `unknown cycleType ${cycleType}`, 400);
  }
};

// Function-signature rule enforcement: confirmation is required and must be
// non-empty. There is no zero-arg "accidentally run a cycle" path.
export const createCycleRunner = ({ db, cycleModel, outDir }) => {
  const runCycle = async (cycleId, { confirmation } = {}) => {
    if (!confirmation || typeof confirmation !== 'string' || confirmation.length < 4) {
      throw new AppError(
        'VALIDATION_FAILED',
        'cycleRunner.run requires a confirmation token (≥ 4 chars)',
        400
      );
    }
    return db.withTransaction(async (client) => {
      const cycle = await cycleModel.findByIdForUpdate(client, cycleId);
      if (!cycle) throw new AppError('NOT_FOUND', `cycle ${cycleId} not found`, 404);
      if (cycle.state === 'completed') {
        // Idempotent: re-running a completed cycle is a no-op.
        return { cycle, movements: await cycleModel.listMovements(client, cycleId), idempotent: true };
      }
      if (cycle.state === 'running') {
        throw new AppError('CONFLICT', `cycle ${cycleId} is already running`, 409);
      }
      if (cycle.state !== 'pending') {
        throw new AppError(
          'CONFLICT',
          `cycle ${cycleId} cannot run from state ${cycle.state}`,
          409
        );
      }

      const startedCycle = await cycleModel.updateState(client, {
        id: cycleId,
        state: 'running',
        fields: { started_at: new Date().toISOString() }
      });

      const positions = await settlementPositionsService.listPositions({
        currency: cycle.currency
      });
      const movements = positions
        .map((p) => ({
          participantCode: p.participantCode,
          netPositionMinor: p.positionMinor,
          movementMinor: p.positionMinor
        }))
        .filter((m) => BigInt(m.movementMinor) !== 0n);

      let totalDr = 0n;
      let totalCr = 0n;
      const reason = journalReasonForCycle(cycle.cycle_type);
      const operatingDate =
        cycle.operating_date instanceof Date
          ? cycle.operating_date.toISOString().slice(0, 10)
          : cycle.operating_date;

      // Ensure the rail's RTGS nostro account exists before posting.
      await ledgerService._internal.ensureAccountOnClient(client, {
        accountType: ACCOUNT_TYPES.OPERATOR_RTGS_NOSTRO,
        currency: cycle.currency
      });

      // One journal per movement. Each movement is a 2-leg post that drains
      // the participant's settlement position back to zero by the offset
      // movement against OPERATOR_RTGS_NOSTRO.
      for (const m of movements) {
        const move = BigInt(m.movementMinor);
        const absMove = move < 0n ? -move : move;
        const partyAccount = accountCodeFor({
          accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
          ownerId: m.participantCode,
          currency: cycle.currency
        });
        const nostro = accountCodeFor({
          accountType: ACCOUNT_TYPES.OPERATOR_RTGS_NOSTRO,
          currency: cycle.currency
        });
        // Drain the participant: if position > 0 (rail owes participant),
        // we DR participant_settlement (return to 0) and CR nostro (rail
        // pays out). If position < 0 (participant owes rail), the opposite.
        const entries = move > 0n
          ? [
              { accountCode: partyAccount, side: 'DR', amount: String(absMove), currency: cycle.currency },
              { accountCode: nostro, side: 'CR', amount: String(absMove), currency: cycle.currency }
            ]
          : [
              { accountCode: nostro, side: 'DR', amount: String(absMove), currency: cycle.currency },
              { accountCode: partyAccount, side: 'CR', amount: String(absMove), currency: cycle.currency }
            ];
        const journal = await ledgerService.postJournal(client, {
          reason,
          referenceType: 'cycle',
          referenceId: cycleId,
          operatingDate,
          entries,
          metadata: {
            cycleType: cycle.cycle_type,
            participantCode: m.participantCode,
            netPositionMinor: m.netPositionMinor
          }
        });
        await cycleModel.insertMovement(client, {
          id: uuidv7(),
          cycleId,
          participantCode: m.participantCode,
          currency: cycle.currency,
          netPositionMinor: m.netPositionMinor,
          movementMinor: m.movementMinor,
          postedJournalId: journal.journalId
        });
        if (move > 0n) totalDr += absMove; else totalCr += absMove;
      }

      // Reset positions for this currency to zero, stamped with cycle id.
      await settlementPositionsService.resetPositionsForCycleOnClient(client, {
        cycleId,
        participantCodes: movements.map((m) => m.participantCode),
        currency: cycle.currency
      });

      // Write the RTGS file out (best-effort; failure aborts the txn).
      const rtgs = writeRtgsCsv({
        cycleId,
        operatingDate,
        currency: cycle.currency,
        movements,
        outDir
      });

      const completed = await cycleModel.updateState(client, {
        id: cycleId,
        state: 'completed',
        fields: {
          completed_at: new Date().toISOString(),
          net_movement_count: movements.length,
          total_dr_minor: String(totalDr),
          total_cr_minor: String(totalCr),
          rtgs_output_path: rtgs.path
        }
      });

      await auditService.record(client, {
        actorType: 'system',
        eventType: 'cycle.completed',
        resourceType: 'settlement_cycle',
        resourceId: cycleId,
        payload: {
          cycleType: cycle.cycle_type,
          currency: cycle.currency,
          movements: movements.length,
          totalDrMinor: String(totalDr),
          totalCrMinor: String(totalCr),
          rtgsOutputPath: rtgs.path
        }
      });

      return {
        cycle: completed,
        movements: await cycleModel.listMovements(client, cycleId),
        rtgsPath: rtgs.path,
        idempotent: false,
        startedFrom: startedCycle.state
      };
    });
  };

  // Function-signature rule: closeCycle requires a closingReason and is
  // distinct from runCycle. Used by EOD to mark a cycle force-closed
  // (failed/operator-killed).
  const closeCycle = async (cycleId, closingReason) => {
    if (!closingReason || typeof closingReason !== 'string') {
      throw new AppError(
        'VALIDATION_FAILED',
        'closeCycle requires a closingReason',
        400
      );
    }
    return db.withTransaction(async (client) => {
      const cycle = await cycleModel.findByIdForUpdate(client, cycleId);
      if (!cycle) throw new AppError('NOT_FOUND', `cycle ${cycleId} not found`, 404);
      if (cycle.state === 'completed') return { cycle, idempotent: true };
      const updated = await cycleModel.updateState(client, {
        id: cycleId,
        state: 'failed',
        fields: { completed_at: new Date().toISOString() }
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'cycle.failed',
        resourceType: 'settlement_cycle',
        resourceId: cycleId,
        payload: { closingReason }
      });
      return { cycle: updated, idempotent: false };
    });
  };

  return { runCycle, closeCycle };
};
