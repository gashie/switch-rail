// Fake market-maker. Returns deterministic test rates that match the
// crossborder-rails simulator's TEST_RATES so quote+settlement comparisons
// work end-to-end. Production swaps this with a real HTTP client.

import { AppError } from '../../core/errors.js';
import { TEST_RATES } from '../crossborder-rails/index.js';

// Allow tests to nudge the rate away from TEST_RATES so we can exercise
// slippage-protection paths.
const _overrides = new Map();

export const setRateOverride = (pair, rateDecimalStr) => {
  _overrides.set(pair, rateDecimalStr);
};

export const clearRateOverrides = () => {
  _overrides.clear();
};

export const createMakerFakeClient = ({ makerCode = 'FAKE_MAKER' } = {}) => ({
  makerCode,
  quote: async ({ payCurrency, receiveCurrency }) => {
    const pair = `${payCurrency}:${receiveCurrency}`;
    const rate = _overrides.get(pair) || TEST_RATES[pair];
    if (!rate) {
      throw new AppError(
        'NOT_FOUND',
        `fake maker has no rate for pair ${pair}`,
        404
      );
    }
    return {
      rateDecimalStr: rate,
      feePayMinor: '0',
      feeReceiveMinor: '0'
    };
  }
});
