import { parseRest } from './parser.js';
import { formatRest, verifyEnvelope } from './formatter.js';

export const createRestService = ({ envelope, cryptoKeys }) => ({
  inbound: async (jsonBody) => {
    const parsed = parseRest(jsonBody);
    return envelope.ingest(parsed);
  },

  outbound: (env) => formatRest(env, { cryptoKeys }),

  verify: (env) => verifyEnvelope(env, { cryptoKeys })
});
