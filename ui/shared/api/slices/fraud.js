import { sikaApi } from '../base.js';
import { buildQs } from '../qs.js';

export const fraudApi = sikaApi.injectEndpoints({
  endpoints: (b) => ({
    listFraudCases: b.query({
      query: (params) => `/fraud/cases${buildQs(params)}`,
      providesTags: (r) =>
        r?.items
          ? [...r.items.map((c) => ({ type: 'Fraud', id: c.id })), { type: 'Fraud', id: 'LIST' }]
          : [{ type: 'Fraud', id: 'LIST' }]
    }),
    getFraudCase: b.query({
      query: (id) => `/fraud/cases/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Fraud', id }]
    }),
    confirmFraudCase: b.mutation({
      query: ({ id, reason }) => ({
        url: `/fraud/cases/${id}/confirm`,
        method: 'POST',
        body: { reason }
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Fraud', id }, { type: 'Fraud', id: 'LIST' }]
    }),
    listRulePack: b.query({
      query: () => '/fraud/rules',
      providesTags: [{ type: 'Fraud', id: 'RULES' }]
    }),
    listSanctionsHits: b.query({
      query: (params) => `/sanctions/hits${buildQs(params)}`,
      providesTags: [{ type: 'Fraud', id: 'SANCTIONS' }]
    })
  })
});

export const {
  useListFraudCasesQuery,
  useGetFraudCaseQuery,
  useConfirmFraudCaseMutation,
  useListRulePackQuery,
  useListSanctionsHitsQuery
} = fraudApi;
