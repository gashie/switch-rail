import { sikaApi } from '../base.js';
import { buildQs } from '../qs.js';

export const disputesApi = sikaApi.injectEndpoints({
  endpoints: (b) => ({
    listDisputes: b.query({
      query: (params) => `/disputes${buildQs(params)}`,
      providesTags: (r) =>
        r?.items
          ? [...r.items.map((d) => ({ type: 'Disputes', id: d.id })), { type: 'Disputes', id: 'LIST' }]
          : [{ type: 'Disputes', id: 'LIST' }]
    }),
    getDispute: b.query({
      query: (id) => `/disputes/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Disputes', id }]
    }),
    fileDispute: b.mutation({
      query: (body) => ({ url: '/disputes', method: 'POST', body }),
      invalidatesTags: [{ type: 'Disputes', id: 'LIST' }]
    }),
    addEvidence: b.mutation({
      query: ({ id, evidenceType, payload }) => ({
        url: `/disputes/${id}/evidence`,
        method: 'POST',
        body: { evidenceType, payload }
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Disputes', id }]
    }),
    adjudicate: b.mutation({
      query: ({ id, ruling, reason }) => ({
        url: `/disputes/${id}/adjudicate`,
        method: 'POST',
        body: { ruling, reason }
      }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Disputes', id }, { type: 'Disputes', id: 'LIST' }]
    }),
    fastTrackInvoke: b.mutation({
      query: (body) => ({ url: '/fast-track/invoke', method: 'POST', body }),
      invalidatesTags: [{ type: 'Disputes', id: 'LIST' }, { type: 'Transactions', id: 'LIST' }]
    })
  })
});

export const {
  useListDisputesQuery,
  useGetDisputeQuery,
  useFileDisputeMutation,
  useAddEvidenceMutation,
  useAdjudicateMutation,
  useFastTrackInvokeMutation
} = disputesApi;
