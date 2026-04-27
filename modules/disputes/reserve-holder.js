import { AppError } from '../../core/errors.js';
import { ACCOUNT_TYPES, JOURNAL_REASONS, accountCodeFor, ledgerService } from '../ledger/index.js';
import { STATES } from './states.js';

// Function-signature rule enforcement: holdAmount requires the case to be
// in ACCEPTED state and that no prior reserve_journal_id exists. The
// function refuses to run otherwise — preventing accidental double-holds
// and out-of-order calls.
export const createReserveHolder = ({ model }) => {
  const holdAmount = async (
    client,
    { caseId, amountMinor, currency, beneficiaryParticipant, operatingDate }
  ) => {
    const c = await model.findById(client, caseId);
    if (!c) throw new AppError('NOT_FOUND', `dispute ${caseId} not found`, 404);
    if (c.state !== STATES.ACCEPTED) {
      throw new AppError(
        'CONFLICT',
        `reserveHolder.holdAmount requires state ACCEPTED, got ${c.state}`,
        409
      );
    }
    if (c.reserve_journal_id) {
      // Idempotent — already held.
      return { held: false, journalId: c.reserve_journal_id, deduped: true };
    }

    // Ensure both ledger accounts exist.
    await ledgerService._internal.ensureAccountOnClient(client, {
      accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
      ownerId: beneficiaryParticipant,
      currency
    });
    await ledgerService._internal.ensureAccountOnClient(client, {
      accountType: ACCOUNT_TYPES.RAIL_DISPUTE_RESERVE,
      currency
    });

    const beneCode = accountCodeFor({
      accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
      ownerId: beneficiaryParticipant,
      currency
    });
    const reserveCode = accountCodeFor({
      accountType: ACCOUNT_TYPES.RAIL_DISPUTE_RESERVE,
      currency
    });

    // DR beneficiary settlement, CR rail dispute reserve.
    const journal = await ledgerService._internal.postJournalOnClient(client, {
      reason: JOURNAL_REASONS.DISPUTE_RESERVE_HOLD,
      referenceType: 'dispute_case',
      referenceId: caseId,
      operatingDate,
      entries: [
        { accountCode: beneCode,    side: 'DR', amount: String(amountMinor), currency },
        { accountCode: reserveCode, side: 'CR', amount: String(amountMinor), currency }
      ],
      metadata: { caseNumber: c.case_number, action: 'hold' }
    });

    return { held: true, journalId: journal.journalId, deduped: false };
  };

  return { holdAmount };
};
