import { sikaApi } from '../base.js';

export const publicStatusApi = sikaApi.injectEndpoints({
  endpoints: (b) => ({
    getPublicStatus: b.query({
      query: () => '/public-status/summary'
    }),
    getIncidentUpdates: b.query({
      query: (id) => `/public-status/incidents/${id}/updates`
    }),
    verifyReceipt: b.mutation({
      query: (body) => ({ url: '/public-status/verify-receipt', method: 'POST', body })
    })
  })
});

export const {
  useGetPublicStatusQuery,
  useGetIncidentUpdatesQuery,
  useVerifyReceiptMutation
} = publicStatusApi;
