import { sikaApi } from '../base.js';
import { buildQs } from '../qs.js';

export const networkGraphApi = sikaApi.injectEndpoints({
  endpoints: (b) => ({
    getGraphSlice: b.query({
      query: (params) => `/fraud/network-graph${buildQs(params)}`,
      providesTags: [{ type: 'NetworkGraph', id: 'SLICE' }]
    }),
    getReputation: b.query({
      query: (subjectKey) => `/fraud/network-graph/reputation/${encodeURIComponent(subjectKey)}`,
      providesTags: (_r, _e, k) => [{ type: 'NetworkGraph', id: `rep-${k}` }]
    })
  })
});

export const { useGetGraphSliceQuery, useGetReputationQuery } = networkGraphApi;
