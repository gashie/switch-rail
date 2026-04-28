// Posts the two ledger legs of a cross-border transaction directly via
// ledgerService — both touch rail-internal accounts (RAIL_FX_NOSTRO and
// RAIL_FOREIGN_RAIL_NOSTRO), per the Phase 8 overlay-rule refinement.
//
// Leg 1: DR participant settlement (originator), CR rail FX nostro (pay ccy).
// Leg 2: DR rail FX nostro (receive ccy),       CR foreign rail nostro (receive ccy).
//
// Both legs share the same withTransaction in the coordinator. The currency
// imbalance between leg 1 (pay ccy) and leg 2 (receive ccy) is real — it's
// the FX position the rail carries on its own books, hedged separately
// (Phase 11+).

import {
  ACCOUNT_TYPES,
  JOURNAL_REASONS,
  accountCodeFor,
  ledgerService
} from '../ledger/index.js';

const todayUtc = () => new Date().toISOString().slice(0, 10);

export const postLeg1 = async (client, { transaction, payCurrency, payAmountMinor }) => {
  await ledgerService._internal.ensureAccountOnClient(client, {
    accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
    ownerId: transaction.originator_participant,
    currency: payCurrency
  });
  await ledgerService._internal.ensureAccountOnClient(client, {
    accountType: ACCOUNT_TYPES.RAIL_FX_NOSTRO,
    currency: payCurrency
  });
  const result = await ledgerService._internal.postJournalOnClient(client, {
    reason: JOURNAL_REASONS.XB_LEG_1,
    referenceType: 'crossborder_tx',
    referenceId: transaction.id,
    operatingDate: todayUtc(),
    entries: [
      {
        accountCode: accountCodeFor({
          accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
          ownerId: transaction.originator_participant,
          currency: payCurrency
        }),
        side: 'DR', amount: String(payAmountMinor), currency: payCurrency
      },
      {
        accountCode: accountCodeFor({ accountType: ACCOUNT_TYPES.RAIL_FX_NOSTRO, currency: payCurrency }),
        side: 'CR', amount: String(payAmountMinor), currency: payCurrency
      }
    ],
    metadata: { leg: 1 }
  });
  return result.journalId;
};

export const postLeg2 = async (
  client,
  { transaction, foreignRailCode, receiveCurrency, receiveAmountMinor }
) => {
  await ledgerService._internal.ensureAccountOnClient(client, {
    accountType: ACCOUNT_TYPES.RAIL_FX_NOSTRO,
    currency: receiveCurrency
  });
  await ledgerService._internal.ensureAccountOnClient(client, {
    accountType: ACCOUNT_TYPES.RAIL_FOREIGN_RAIL_NOSTRO,
    ownerId: foreignRailCode,
    currency: receiveCurrency
  });
  const result = await ledgerService._internal.postJournalOnClient(client, {
    reason: JOURNAL_REASONS.XB_LEG_2,
    referenceType: 'crossborder_tx',
    referenceId: transaction.id,
    operatingDate: todayUtc(),
    entries: [
      {
        accountCode: accountCodeFor({ accountType: ACCOUNT_TYPES.RAIL_FX_NOSTRO, currency: receiveCurrency }),
        side: 'DR', amount: String(receiveAmountMinor), currency: receiveCurrency
      },
      {
        accountCode: accountCodeFor({
          accountType: ACCOUNT_TYPES.RAIL_FOREIGN_RAIL_NOSTRO,
          ownerId: foreignRailCode,
          currency: receiveCurrency
        }),
        side: 'CR', amount: String(receiveAmountMinor), currency: receiveCurrency
      }
    ],
    metadata: { leg: 2, foreignRailCode }
  });
  return result.journalId;
};

// Compensating reversal: emits the inverse of leg 1 + leg 2 in a single
// journal-per-leg pair when the foreign rail rejects after the local commit.
export const postCompensation = async (
  client,
  {
    transaction, foreignRailCode,
    payCurrency, payAmountMinor,
    receiveCurrency, receiveAmountMinor,
    reason
  }
) => {
  const result = await ledgerService._internal.postJournalOnClient(client, {
    reason: JOURNAL_REASONS.XB_COMPENSATE,
    referenceType: 'crossborder_tx',
    referenceId: transaction.id,
    operatingDate: todayUtc(),
    entries: [
      // Inverse leg 1: CR participant settlement, DR rail FX nostro (pay ccy).
      {
        accountCode: accountCodeFor({ accountType: ACCOUNT_TYPES.RAIL_FX_NOSTRO, currency: payCurrency }),
        side: 'DR', amount: String(payAmountMinor), currency: payCurrency
      },
      {
        accountCode: accountCodeFor({
          accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
          ownerId: transaction.originator_participant,
          currency: payCurrency
        }),
        side: 'CR', amount: String(payAmountMinor), currency: payCurrency
      },
      // Inverse leg 2: DR foreign rail nostro, CR rail FX nostro (recv ccy).
      {
        accountCode: accountCodeFor({
          accountType: ACCOUNT_TYPES.RAIL_FOREIGN_RAIL_NOSTRO,
          ownerId: foreignRailCode,
          currency: receiveCurrency
        }),
        side: 'DR', amount: String(receiveAmountMinor), currency: receiveCurrency
      },
      {
        accountCode: accountCodeFor({ accountType: ACCOUNT_TYPES.RAIL_FX_NOSTRO, currency: receiveCurrency }),
        side: 'CR', amount: String(receiveAmountMinor), currency: receiveCurrency
      }
    ],
    metadata: { compensate: true, reason: reason || 'foreign_reject' }
  });
  return result.journalId;
};
