import { sikaApi } from '../base.js';
import { buildQs } from '../qs.js';

export const crossborderApi = sikaApi.injectEndpoints({
  endpoints: (b) => ({
    listCrossborder: b.query({
      query: (params) => `/crossborder/transactions${buildQs(params)}`,
      providesTags: (r) =>
        r?.items
          ? [...r.items.map((t) => ({ type: 'Crossborder', id: t.id })), { type: 'Crossborder', id: 'LIST' }]
          : [{ type: 'Crossborder', id: 'LIST' }]
    }),
    getCrossborder: b.query({
      query: (id) => `/crossborder/transactions/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Crossborder', id }]
    }),
    listForeignRails: b.query({
      query: () => '/crossborder/foreign-rails',
      providesTags: [{ type: 'ForeignRails', id: 'LIST' }]
    }),
    quoteFx: b.mutation({
      query: (body) => ({ url: '/crossborder/fx/quote', method: 'POST', body }),
      invalidatesTags: [{ type: 'FxQuotes', id: 'LIST' }]
    }),
    listFxQuotes: b.query({
      query: (params) => `/crossborder/fx/quotes${buildQs(params)}`,
      providesTags: [{ type: 'FxQuotes', id: 'LIST' }]
    }),
    listTravelRule: b.query({
      query: (params) => `/crossborder/travel-rule${buildQs(params)}`,
      providesTags: [{ type: 'TravelRule', id: 'LIST' }]
    })
  })
});

export const {
  useListCrossborderQuery,
  useGetCrossborderQuery,
  useListForeignRailsQuery,
  useQuoteFxMutation,
  useListFxQuotesQuery,
  useListTravelRuleQuery
} = crossborderApi;
