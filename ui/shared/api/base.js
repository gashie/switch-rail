// Shared RTK Query base. Each app builds its own store on top of this.
// Default base URL: '/api' (Vite dev proxy points it at the rail).
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

const TAGS = [
  'Transactions',
  'Disputes',
  'Participants',
  'Settlement',
  'Fraud',
  'Crossborder',
  'Audit',
  'Eod',
  'NetworkGraph',
  'Aliases',
  'ForeignRails',
  'FxQuotes',
  'TravelRule',
  'Mandates',
  'BulkBatches',
  'Liquidity'
];

export const sikaApi = createApi({
  reducerPath: 'sikaApi',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api',
    credentials: 'include',
    prepareHeaders: (headers) => {
      headers.set('accept', 'application/json');
      return headers;
    }
  }),
  tagTypes: TAGS,
  endpoints: () => ({})
});

export const apiTags = Object.freeze(TAGS);

export default sikaApi;
