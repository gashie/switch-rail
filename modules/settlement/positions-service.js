import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { ledgerService, registerOnPostedHook, accountCodeFor, ACCOUNT_TYPES } from '../ledger/index.js';

// Settlement positions are a strictly-derived materialized view of the
// ledger. The hook below runs inside the same DB transaction as the
// underlying journal insert so the view never lags the source of truth.
// Any breach is a recoverable bug — the recompute path rebuilds from the
// journal alone.

export const createPositionsService = ({ db, model }) => {
  const applyJournalToPositionsOnClient = async (client, journalId) => {
    const postings = await model.participantPostingsForJournal(client, journalId);
    for (const p of postings) {
      const sign = p.side === 'CR' ? 1n : -1n;
      const delta = sign * BigInt(p.amount_value);
      await model.upsertDelta(client, {
        id: uuidv7(),
        participantCode: p.participant_code,
        currency: p.currency,
        deltaMinor: delta.toString(),
        lastJournalId: journalId
      });
    }
    return { count: postings.length };
  };

  const positionFor = (participantCode, currency) =>
    db.withClient(async (c) => {
      const row = await model.findByParticipantCurrency(c, participantCode, currency);
      if (!row) {
        return {
          participantCode,
          currency,
          positionMinor: '0',
          lastJournalId: null,
          lastCycleId: null,
          updatedAt: null
        };
      }
      return {
        participantCode: row.participant_code,
        currency: row.currency,
        positionMinor: String(row.position_minor),
        lastJournalId: row.last_journal_id,
        lastCycleId: row.last_cycle_id,
        updatedAt: row.updated_at
      };
    });

  const listForParticipant = (participantCode) =>
    db.withClient(async (c) => {
      const rows = await model.listForParticipant(c, participantCode);
      return rows.map((r) => ({
        participantCode: r.participant_code,
        currency: r.currency,
        positionMinor: String(r.position_minor),
        lastJournalId: r.last_journal_id,
        lastCycleId: r.last_cycle_id,
        updatedAt: r.updated_at
      }));
    });

  const listPositions = ({ currency } = {}) =>
    db.withClient(async (c) => {
      const rows = await model.listAll(c, { currency });
      return rows.map((r) => ({
        participantCode: r.participant_code,
        currency: r.currency,
        positionMinor: String(r.position_minor),
        lastJournalId: r.last_journal_id,
        lastCycleId: r.last_cycle_id,
        updatedAt: r.updated_at
      }));
    });

  const resetPositionsForCycleOnClient = async (
    client,
    { cycleId, participantCodes, currency }
  ) => {
    if (!cycleId) throw new AppError('VALIDATION_FAILED', 'cycleId required', 400);
    let count = 0;
    for (const code of participantCodes) {
      const updated = await model.setPositionToZero(client, {
        participantCode: code,
        currency,
        lastCycleId: cycleId
      });
      if (updated) count += 1;
    }
    return { count };
  };

  // Break-glass rebuild from the journal alone. Re-derives the absolute
  // position for every (participant, currency) by summing all postings
  // against the corresponding PSET account. Strictly-derived view.
  // Skips PSET accounts whose owner_id is no longer a registered
  // participant (orphaned ledger rows from earlier test runs); the
  // settlement_positions FK would reject them anyway.
  const recomputeAll = async ({ currency, participantCode } = {}) =>
    db.withTransaction(async (client) => {
      const accounts = await ledgerService.listAccounts({
        ownerType: 'PARTICIPANT',
        currency,
        accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT
      });
      const filtered = participantCode
        ? accounts.filter((a) => a.owner_id === participantCode)
        : accounts;
      const liveOwners = await model.filterToExistingParticipants(
        client,
        filtered.map((a) => a.owner_id)
      );
      const live = filtered.filter((a) => liveOwners.has(a.owner_id));
      let updated = 0;
      for (const acc of live) {
        const code = accountCodeFor({
          accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
          ownerId: acc.owner_id,
          currency: acc.currency
        });
        const { net, lastJournalId } = await model.recomputeFullForAccount(client, code);
        await model.setPositionAbsolute(client, {
          participantCode: acc.owner_id,
          currency: acc.currency,
          positionMinor: net,
          lastJournalId
        });
        updated += 1;
      }
      return { updated, skipped: filtered.length - live.length };
    });

  // Wire the hook into the ledger service so every postJournal push
  // triggers a position update inside the same transaction.
  registerOnPostedHook(applyJournalToPositionsOnClient);

  return {
    applyJournalToPositionsOnClient,
    positionFor,
    listForParticipant,
    listPositions,
    resetPositionsForCycleOnClient,
    recomputeAll
  };
};
