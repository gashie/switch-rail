import { sikaApi } from '../base.js';

const buildQs = (params = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
};

export const transactionsApi = sikaApi.injectEndpoints({
  endpoints: (b) => ({
    listTransactions: b.query({
      query: (params) => `/transactions${buildQs(params)}`,
      providesTags: (result) => {
        const rows = result?.rows || result?.items;
        return rows
          ? [
              ...rows.map((t) => ({ type: 'Transactions', id: t.id })),
              { type: 'Transactions', id: 'LIST' }
            ]
          : [{ type: 'Transactions', id: 'LIST' }];
      }
    }),
    getTransaction: b.query({
      query: (id) => `/transactions/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Transactions', id }]
    }),
    listAuthEvents: b.query({
      query: (txId) => `/transactions/${txId}/history`,
      providesTags: (_r, _e, txId) => [{ type: 'Transactions', id: `${txId}-events` }]
    }),
    forceRejectTransaction: b.mutation({
      query: ({ id, reason }) => ({
        url: `/transactions/${id}/force-reject`,
        method: 'POST',
        body: { reason }
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Transactions', id }, { type: 'Transactions', id: 'LIST' }]
    })
  })
});

export const {
  useListTransactionsQuery,
  useGetTransactionQuery,
  useListAuthEventsQuery,
  useForceRejectTransactionMutation
} = transactionsApi;
