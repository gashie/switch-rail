import { sikaApi } from '../base.js';
import { buildQs } from '../qs.js';

export const auditApi = sikaApi.injectEndpoints({
  endpoints: (b) => ({
    listAudit: b.query({
      query: (params) => `/audit/events${buildQs(params)}`,
      providesTags: [{ type: 'Audit', id: 'LIST' }]
    }),
    getDailyChain: b.query({
      query: (date) => `/audit/chain/${date}`,
      providesTags: (_r, _e, date) => [{ type: 'Audit', id: `chain-${date}` }]
    })
  })
});

export const { useListAuditQuery, useGetDailyChainQuery } = auditApi;
