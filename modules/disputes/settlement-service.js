import { AppError } from '../../core/errors.js';
import { auditService } from '../audit/index.js';
import {
  ACCOUNT_TYPES,
  JOURNAL_REASONS,
  accountCodeFor,
  ledgerService
} from '../ledger/index.js';
import { reversalsService } from '../reversals/index.js';
import { transactionsService } from '../transactions/index.js';
import { OUTCOMES } from './codes.js';
import { STATES } from './states.js';

const operatingDateFor = (tx) => {
  const ts = tx.confirmed_at || tx.authorized_at || tx.created_at || new Date();
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toISOString().slice(0, 10);
};

// Post the reserve-release ledger journal. Returns { journalId }.
//   UPHOLD       -> DR RAIL_DISPUTE_RESERVE, CR PARTICIPANT_SETTLEMENT(originator)
//   REJECT/DENIED -> DR RAIL_DISPUTE_RESERVE, CR PARTICIPANT_SETTLEMENT(beneficiary)
//   PARTIAL      -> DR RAIL_DISPUTE_RESERVE: amount
//                   CR PARTICIPANT_SETTLEMENT(originator): outcome_amount_minor
//                   CR PARTICIPANT_SETTLEMENT(beneficiary): amount - outcome_amount_minor
const postReleaseJournal = async (
  client,
  { caseRow, transaction, outcome, outcomeAmountMinor }
) => {
  const currency = caseRow.currency;
  const amount = BigInt(caseRow.amount_minor);
  const operatingDate = operatingDateFor(transaction);
  const reserveCode = accountCodeFor({
    accountType: ACCOUNT_TYPES.RAIL_DISPUTE_RESERVE,
    currency
  });
  const originatorCode = accountCodeFor({
    accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
    ownerId: transaction.originator_participant,
    currency
  });
  const beneficiaryCode = accountCodeFor({
    accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
    ownerId: transaction.beneficiary_participant,
    currency
  });

  // Make sure all three accounts exist.
  await ledgerService._internal.ensureAccountOnClient(client, {
    accountType: ACCOUNT_TYPES.RAIL_DISPUTE_RESERVE,
    currency
  });
  await ledgerService._internal.ensureAccountOnClient(client, {
    accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
    ownerId: transaction.originator_participant,
    currency
  });
  await ledgerService._internal.ensureAccountOnClient(client, {
    accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
    ownerId: transaction.beneficiary_participant,
    currency
  });

  let entries;
  if (outcome === OUTCOMES.UPHOLD) {
    entries = [
      { accountCode: reserveCode,    side: 'DR', amount: String(amount), currency },
      { accountCode: originatorCode, side: 'CR', amount: String(amount), currency }
    ];
  } else if (outcome === OUTCOMES.REJECT) {
    entries = [
      { accountCode: reserveCode,     side: 'DR', amount: String(amount), currency },
      { accountCode: beneficiaryCode, side: 'CR', amount: String(amount), currency }
    ];
  } else if (outcome === OUTCOMES.PARTIAL) {
    if (!outcomeAmountMinor) {
      throw new AppError('VALIDATION_FAILED', 'PARTIAL outcome requires outcomeAmountMinor', 400);
    }
    const upheldShare = BigInt(outcomeAmountMinor);
    if (upheldShare <= 0n || upheldShare >= amount) {
      throw new AppError(
        'VALIDATION_FAILED',
        `outcomeAmountMinor must be > 0 and < ${amount} for PARTIAL`,
        400
      );
    }
    const rejectedShare = amount - upheldShare;
    entries = [
      { accountCode: reserveCode,     side: 'DR', amount: String(amount), currency },
      { accountCode: originatorCode,  side: 'CR', amount: String(upheldShare), currency },
      { accountCode: beneficiaryCode, side: 'CR', amount: String(rejectedShare), currency }
    ];
  } else {
    throw new AppError('VALIDATION_FAILED', `unknown outcome ${outcome}`, 400);
  }

  const result = await ledgerService._internal.postJournalOnClient(client, {
    reason: JOURNAL_REASONS.DISPUTE_RESERVE_RELEASE,
    referenceType: 'dispute_case',
    referenceId: caseRow.id,
    operatingDate,
    entries,
    metadata: { caseNumber: caseRow.case_number, outcome }
  });
  return { journalId: result.journalId };
};

export const createSettlementService = ({
  db,
  casesModel,
  decisionModel,
  disputesService
}) => {
  // Settle an AUTO_RESOLVED case: post release journal, transition to SETTLED.
  // For UPHOLD also initiate the reversal (separate transaction). Idempotent
  // — re-running on a SETTLED case is a no-op.
  const settleAutoResolved = async ({ caseNumber }) => {
    const settled = await db.withTransaction(async (client) => {
      const c = await casesModel.findByCaseNumber(client, caseNumber);
      if (!c) throw new AppError('NOT_FOUND', `case ${caseNumber} not found`, 404);
      if (c.state === STATES.SETTLED) return { case: c, settled: false, deduped: true };
      if (c.state !== STATES.AUTO_RESOLVED) {
        throw new AppError(
          'CONFLICT',
          `settleAutoResolved requires state AUTO_RESOLVED, got ${c.state}`,
          409
        );
      }
      const tx = await transactionsService.findById(c.transaction_id, client);
      if (!tx) throw new AppError('NOT_FOUND', `transaction ${c.transaction_id} not found`, 404);
      const release = await postReleaseJournal(client, {
        caseRow: c,
        transaction: tx,
        outcome: c.outcome,
        outcomeAmountMinor: c.outcome_amount_minor
      });
      const updated = await disputesService.transition(client, c.id, STATES.SETTLED, {
        reason: 'AUTO_SETTLED',
        payload: { fields: { release_journal_id: release.journalId } },
        occurredBy: 'system'
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'dispute.settled',
        resourceType: 'dispute_case',
        resourceId: c.id,
        payload: { releaseJournalId: release.journalId, outcome: c.outcome, decisionType: 'AUTO' }
      });
      return { case: updated, transaction: tx, settled: true };
    });

    if (settled.settled && settled.case.outcome === OUTCOMES.UPHOLD) {
      // Initiate the reversal of the original transaction. Outside the
      // dispute settlement transaction, since reversalsService opens its
      // own (mirrors the fast-track-reversal pattern).
      try {
        await reversalsService.initiate({
          originalTxId: settled.case.transaction_id,
          reasonCode: 'CUST',
          reasonMessage: `auto-resolved dispute ${settled.case.case_number}: ${settled.case.outcome_notes}`,
          initiatedBy: 'system'
        });
      } catch (e) {
        // The transaction may already be in a non-CONFIRMED state (e.g. already
        // REVERSED via fast-track). Audit the failure and continue.
        await db.withTransaction((client) =>
          auditService.record(client, {
            actorType: 'system',
            eventType: 'dispute.reversal_skipped',
            resourceType: 'dispute_case',
            resourceId: settled.case.id,
            payload: { reason: e?.message || String(e) }
          })
        );
      }
    }
    return settled;
  };

  // Confirm settlement for a manual decision case in {UPHELD, PARTIAL_UPHELD,
  // DENIED}. Maker-checker enforced: confirmedByUser must differ from the
  // user who decided the case (decision.decided_by_user). Posts release
  // journal, transitions to SETTLED, and (for UPHELD/PARTIAL_UPHELD) initiates
  // the reversal.
  const confirmSettlement = async ({ caseNumber, confirmedByUser, notes }) => {
    const settled = await db.withTransaction(async (client) => {
      const c = await casesModel.findByCaseNumber(client, caseNumber);
      if (!c) throw new AppError('NOT_FOUND', `case ${caseNumber} not found`, 404);
      if (c.state === STATES.SETTLED) return { case: c, settled: false, deduped: true };
      const allowed = [STATES.UPHELD, STATES.PARTIAL_UPHELD, STATES.DENIED];
      if (!allowed.includes(c.state)) {
        throw new AppError(
          'CONFLICT',
          `confirmSettlement requires state in {UPHELD, PARTIAL_UPHELD, DENIED}, got ${c.state}`,
          409
        );
      }
      if (c.release_journal_id) {
        return { case: c, settled: false, deduped: true };
      }
      const decision = await decisionModel.findByCaseId(client, c.id);
      if (!decision) {
        throw new AppError(
          'CONFLICT',
          `case ${caseNumber} has no decision row; cannot confirm settlement`,
          409
        );
      }
      // Maker-checker: confirmer cannot be the decider. AUTO decisions have
      // decided_by_user = null, but they shouldn't reach this path anyway.
      if (decision.decided_by_user && decision.decided_by_user === confirmedByUser) {
        throw new AppError(
          'CONFLICT',
          `maker-checker: user ${confirmedByUser} decided this case and cannot confirm its settlement`,
          409
        );
      }
      const tx = await transactionsService.findById(c.transaction_id, client);
      if (!tx) throw new AppError('NOT_FOUND', `transaction ${c.transaction_id} not found`, 404);
      // Outcome mapping from case state.
      let outcome;
      if (c.state === STATES.UPHELD) outcome = OUTCOMES.UPHOLD;
      else if (c.state === STATES.DENIED) outcome = OUTCOMES.REJECT;
      else outcome = OUTCOMES.PARTIAL;
      const release = await postReleaseJournal(client, {
        caseRow: c,
        transaction: tx,
        outcome,
        outcomeAmountMinor: c.outcome_amount_minor
      });
      const updated = await disputesService.transition(client, c.id, STATES.SETTLED, {
        reason: 'CONFIRMED_SETTLEMENT',
        payload: {
          fields: { release_journal_id: release.journalId, outcome_notes: notes ?? c.outcome_notes }
        },
        occurredBy: confirmedByUser ? `user:${confirmedByUser}` : 'operator'
      });
      await auditService.record(client, {
        actorType: 'user',
        actorId: confirmedByUser || null,
        eventType: 'dispute.settled',
        resourceType: 'dispute_case',
        resourceId: c.id,
        payload: {
          releaseJournalId: release.journalId,
          outcome,
          decisionType: 'MANUAL',
          decisionId: decision.id
        }
      });
      return { case: updated, decision, transaction: tx, outcome, settled: true };
    });

    if (settled.settled && (settled.outcome === OUTCOMES.UPHOLD || settled.outcome === OUTCOMES.PARTIAL)) {
      try {
        await reversalsService.initiate({
          originalTxId: settled.case.transaction_id,
          reasonCode: 'CUST',
          reasonMessage: `dispute ${settled.case.case_number} ${settled.case.state.toLowerCase()}`,
          initiatedBy: confirmedByUser ? `operator:${confirmedByUser}` : 'system'
        });
      } catch (e) {
        await db.withTransaction((client) =>
          auditService.record(client, {
            actorType: 'system',
            eventType: 'dispute.reversal_skipped',
            resourceType: 'dispute_case',
            resourceId: settled.case.id,
            payload: { reason: e?.message || String(e) }
          })
        );
      }
    }
    return settled;
  };

  return { settleAutoResolved, confirmSettlement };
};
