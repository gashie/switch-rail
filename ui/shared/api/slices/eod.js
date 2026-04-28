import { sikaApi } from '../base.js';
import { buildQs } from '../qs.js';

export const eodApi = sikaApi.injectEndpoints({
  endpoints: (b) => ({
    listEodRuns: b.query({
      query: (params) => `/eod/runs${buildQs(params)}`,
      providesTags: [{ type: 'Eod', id: 'LIST' }]
    }),
    getEodRun: b.query({
      query: (id) => `/eod/runs/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Eod', id }]
    }),
    cutOver: b.mutation({
      query: (body) => ({ url: '/eod/cutover', method: 'POST', body }),
      invalidatesTags: [{ type: 'Eod', id: 'LIST' }]
    }),
    listReconBreaks: b.query({
      query: (params) => `/recon/breaks${buildQs(params)}`,
      providesTags: [{ type: 'Eod', id: 'RECON' }]
    })
  })
});

export const {
  useListEodRunsQuery,
  useGetEodRunQuery,
  useCutOverMutation,
  useListReconBreaksQuery
} = eodApi;
