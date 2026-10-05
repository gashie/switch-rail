import { describe, expect, it } from 'vitest';
import { sikaApi, apiTags } from '../base.js';
import * as slices from '../slices/index.js';

describe('sikaApi', () => {
  it('has the expected tag types declared', () => {
    for (const t of [
      'Transactions', 'Disputes', 'Participants', 'Settlement',
      'Fraud', 'Crossborder', 'Audit', 'Eod', 'NetworkGraph'
    ]) {
      expect(apiTags).toContain(t);
    }
  });

  it('has the standard RTK Query reducer surface', () => {
    expect(sikaApi.reducerPath).toBe('sikaApi');
    expect(typeof sikaApi.reducer).toBe('function');
    expect(typeof sikaApi.middleware).toBe('function');
    expect(typeof sikaApi.injectEndpoints).toBe('function');
  });

  it('exports the expected hooks across the 9 slices', () => {
    const expected = [
      'useListTransactionsQuery',
      'useGetTransactionQuery',
      'useForceRejectTransactionMutation',
      'useListDisputesQuery',
      'useFileDisputeMutation',
      'useAdjudicateMutation',
      'useFastTrackInvokeMutation',
      'useListParticipantsQuery',
      'useSuspendParticipantMutation',
      'useListPositionsQuery',
      'useCloseCycleMutation',
      'useListLedgerJournalsQuery',
      'useGetLiquidityQuery',
      'useListFraudCasesQuery',
      'useConfirmFraudCaseMutation',
      'useListCrossborderQuery',
      'useListForeignRailsQuery',
      'useQuoteFxMutation',
      'useListAuditQuery',
      'useListEodRunsQuery',
      'useCutOverMutation',
      'useGetGraphSliceQuery'
    ];
    for (const name of expected) {
      expect(typeof slices[name]).toBe('function');
    }
  });
});
