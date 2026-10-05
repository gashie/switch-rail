import { sikaApi } from '../base.js';
import { buildQs } from '../qs.js';

export const settlementApi = sikaApi.injectEndpoints({
  endpoints: (b) => ({
    listPositions: b.query({
      query: (params) => `/settlement/positions${buildQs(params)}`,
      providesTags: [{ type: 'Settlement', id: 'POSITIONS' }]
    }),
    listCycles: b.query({
      query: (params) => `/settlement/cycles${buildQs(params)}`,
      providesTags: [{ type: 'Settlement', id: 'CYCLES' }]
    }),
    closeCycle: b.mutation({
      query: ({ cycleId, reason }) => ({
        url: `/settlement/cycles/${cycleId}/close`,
        method: 'POST',
        body: { reason }
      }),
      invalidatesTags: [{ type: 'Settlement', id: 'CYCLES' }, { type: 'Settlement', id: 'POSITIONS' }]
    }),
    listLedgerJournals: b.query({
      query: (params) => `/ledger/journals${buildQs(params)}`,
      providesTags: [{ type: 'Settlement', id: 'LEDGER' }]
    }),
    getLiquidity: b.query({
      query: (participantCode) => `/liquidity/${participantCode}`,
      providesTags: (_r, _e, code) => [{ type: 'Liquidity', id: code }]
    })
  })
});

export const {
  useListPositionsQuery,
  useListCyclesQuery,
  useCloseCycleMutation,
  useListLedgerJournalsQuery,
  useGetLiquidityQuery
} = settlementApi;
