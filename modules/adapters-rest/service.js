import { parseRest } from './parser.js';
import { formatRest, verifyEnvelope } from './formatter.js';

export const createRestService = ({ envelope, cryptoKeys, orchestrator }) => ({
  inbound: async (jsonBody) => {
    const parsed = parseRest(jsonBody);
    return envelope.ingest(parsed);
  },

  // Phase-4 path: parse → run the full orchestrator (envelope ingest +
  // authorization + routing + credit-leg + atomic outcome). Returns the
  // resulting transaction + envelope so a single REST call drives an
  // end-to-end payment lifecycle.
  process: async (jsonBody) => {
    if (!orchestrator) {
      throw new Error('REST adapter constructed without orchestrator');
    }
    const parsed = parseRest(jsonBody);
    const result = await orchestrator.process(parsed);
    return {
      envelope: parsed,
      transaction: result.transaction,
      transactionId: result.transaction.id,
      state: result.transaction.state,
      reasonCode: result.transaction.reason_code,
      responseCode: result.transaction.response_code,
      deduped: !!result.deduped,
      receipts: result.receipts || []
    };
  },

  outbound: (env) => formatRest(env, { cryptoKeys }),

  verify: (env) => verifyEnvelope(env, { cryptoKeys })
});
