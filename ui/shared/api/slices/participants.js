import { sikaApi } from '../base.js';
import { buildQs } from '../qs.js';

export const participantsApi = sikaApi.injectEndpoints({
  endpoints: (b) => ({
    listParticipants: b.query({
      query: (params) => `/participants${buildQs(params)}`,
      providesTags: (r) =>
        r?.items
          ? [...r.items.map((p) => ({ type: 'Participants', id: p.code })), { type: 'Participants', id: 'LIST' }]
          : [{ type: 'Participants', id: 'LIST' }]
    }),
    getParticipant: b.query({
      query: (code) => `/participants/${code}`,
      providesTags: (_r, _e, code) => [{ type: 'Participants', id: code }]
    }),
    suspendParticipant: b.mutation({
      query: ({ code, reason }) => ({
        url: `/participants/${code}/suspend`,
        method: 'POST',
        body: { reason }
      }),
      invalidatesTags: (_r, _e, { code }) => [{ type: 'Participants', id: code }, { type: 'Participants', id: 'LIST' }]
    }),
    reinstateParticipant: b.mutation({
      query: ({ code, reason }) => ({
        url: `/participants/${code}/reinstate`,
        method: 'POST',
        body: { reason }
      }),
      invalidatesTags: (_r, _e, { code }) => [{ type: 'Participants', id: code }, { type: 'Participants', id: 'LIST' }]
    }),
    listAliases: b.query({
      query: (params) => `/aliases${buildQs(params)}`,
      providesTags: [{ type: 'Aliases', id: 'LIST' }]
    })
  })
});

export const {
  useListParticipantsQuery,
  useGetParticipantQuery,
  useSuspendParticipantMutation,
  useReinstateParticipantMutation,
  useListAliasesQuery
} = participantsApi;
