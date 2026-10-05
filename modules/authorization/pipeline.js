import { duplicates } from './checks/duplicates.js';
import { accountStatus } from './checks/account-status.js';
import { sanctions } from './checks/sanctions.js';
import { fraud } from './checks/fraud.js';
import { limits } from './checks/limits.js';
import { liquidity } from './checks/liquidity.js';

// Pipeline order (locked):
//   duplicates → account-status → sanctions → fraud → limits → liquidity
// Cheap deterministic checks first; liquidity last because it'll be the
// most expensive once Phase 5 lights up the real settlement-position
// reads.
export const PIPELINE = Object.freeze([
  { name: 'duplicates', fn: duplicates },
  { name: 'account-status', fn: accountStatus },
  { name: 'sanctions', fn: sanctions },
  { name: 'fraud', fn: fraud },
  { name: 'limits', fn: limits },
  { name: 'liquidity', fn: liquidity }
]);

/**
 * Run the pipeline against a pre-fetched context. Short-circuits on the
 * first non-passing check and returns its code/message.
 */
export const runPipeline = async (ctx) => {
  for (const { name, fn } of PIPELINE) {
    const r = await fn(ctx);
    if (!r || r.pass !== true) {
      return {
        ok: false,
        check: name,
        code: r?.code || 'RAIL_INTERNAL_ERROR',
        message: r?.message || 'check returned non-pass result'
      };
    }
  }
  return { ok: true };
};
