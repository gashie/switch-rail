// Calls a foreign rail's HTTP contract (instruct + status). Uses the in-process
// simulator when the rail's endpoints point at the local simulator; otherwise
// makes real HTTP calls. Both paths return the same shape so the coordinator
// doesn't branch.

import { AppError } from '../../core/errors.js';
import { config } from '../../core/config.js';
import { foreignRailsSimulator } from '../crossborder-rails/index.js';

const isSimulatorUrl = (url) => /\/simulator-foreign\//.test(url || '');

const withTimeout = (promise, ms) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new AppError('TIMEOUT', `foreign rail timed out after ${ms}ms`, 504)), ms)
  );
  return Promise.race([promise, timeout]);
};

export const createForeignRailClient = ({ railRow }) => {
  const endpoints = railRow.endpoints || {};
  const useSim = isSimulatorUrl(endpoints.instruct) || railRow.metadata?.useInProcessSimulator === true;

  const instruct = async ({ quoteId, originator, beneficiary, travelRule, payAmount, receiveAmount }) => {
    if (useSim) {
      // Wrap the simulator's synchronous throw so the contract is uniform.
      try {
        return foreignRailsSimulator.instruct({ quoteId, originator, beneficiary, travelRule, payAmount, receiveAmount });
      } catch (e) {
        if (e?.code === 'TIMEOUT') {
          // Surface as a TIMEOUT outcome rather than a hard throw — the
          // coordinator/recovery worker can retry.
          throw new AppError('TIMEOUT', e.message, 504);
        }
        throw e;
      }
    }
    const body = JSON.stringify({ quoteId, originator, beneficiary, travelRule, payAmount, receiveAmount });
    const fetchPromise = fetch(endpoints.instruct, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    }).then(async (res) => {
      const text = await res.text();
      try { return JSON.parse(text); } catch { throw new AppError('FOREIGN_RAIL_BAD_RESPONSE', `non-JSON: ${text.slice(0, 80)}`, 502); }
    });
    return withTimeout(fetchPromise, config.foreignRailTimeoutMs);
  };

  const status = async ({ foreignTxId }) => {
    if (useSim) return foreignRailsSimulator.status({ foreignTxId });
    const fetchPromise = fetch(endpoints.status, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foreignTxId })
    }).then(async (res) => {
      const text = await res.text();
      try { return JSON.parse(text); } catch { throw new AppError('FOREIGN_RAIL_BAD_RESPONSE', `non-JSON: ${text.slice(0, 80)}`, 502); }
    });
    return withTimeout(fetchPromise, config.foreignRailTimeoutMs);
  };

  return { instruct, status };
};
