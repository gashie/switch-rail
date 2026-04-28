// Foreign-rail simulator. Implements the same HTTP contract a real PAPSS
// adapter would. Mirrors Phase 4's participant simulator pattern: force
// accounts trigger deterministic behaviors so tests + demo scripts can
// exercise every error path without real external connectivity.
//
// In-memory state for quote storage and async-callback timers. Tests/demo
// share a single simulator instance per process; resets are exposed for
// test isolation.

import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { TEST_RATES, FORCE_ACCOUNT_BEHAVIORS } from './codes.js';

// In-memory stores so the simulator works without DB. Phase 9 doesn't need
// foreign-rail-side persistence — the tests assert behavior, not durability.
const QUOTES = new Map();
const TXS = new Map();

const lookupRate = (payCurrency, receiveCurrency) => {
  const key = `${payCurrency}:${receiveCurrency}`;
  return TEST_RATES[key] || null;
};

// Apply a rate to BigInt minor units. Same algorithm core/money.js will own
// in B9.2; the simulator uses a simplified version that's good enough for
// fixed test rates.
const computeReceiveMinor = (payAmount, rate, payDigits, recvDigits) => {
  const pay = BigInt(payAmount);
  const [intPart, fracPart = ''] = rate.split('.');
  const rateScaleDigits = fracPart.length;
  const rateMantissa = BigInt(intPart + fracPart);
  const adjustDigits = recvDigits - payDigits;
  // (pay * mantissa) * 10^adjustDigits / 10^rateScaleDigits
  let numerator = pay * rateMantissa;
  const denomDigits = rateScaleDigits - adjustDigits;
  if (denomDigits >= 0) {
    const denom = 10n ** BigInt(denomDigits);
    return numerator / denom;
  }
  numerator = numerator * (10n ** BigInt(-denomDigits));
  return numerator;
};

const ISO_MINOR_DIGITS = {
  GHS: 2, NGN: 2, KES: 2, USD: 2, EUR: 2, GBP: 2,
  JPY: 0
};

const minorDigits = (ccy) => ISO_MINOR_DIGITS[ccy] ?? 2;

// Reset hook for test isolation.
export const _resetSimulatorState = () => {
  QUOTES.clear();
  TXS.clear();
};

export const createSimulatorService = () => {
  const quote = ({ payCurrency, receiveCurrency, payAmount }) => {
    const rate = lookupRate(payCurrency, receiveCurrency);
    if (!rate) {
      throw new AppError(
        'VALIDATION_FAILED',
        `simulator has no test rate for ${payCurrency}->${receiveCurrency}`,
        400
      );
    }
    const receiveAmount = computeReceiveMinor(
      payAmount,
      rate,
      minorDigits(payCurrency),
      minorDigits(receiveCurrency)
    );
    const quoteId = uuidv7();
    const lockExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const stored = {
      quoteId,
      payCurrency,
      receiveCurrency,
      payAmount: String(payAmount),
      receiveAmount: receiveAmount.toString(),
      lockedRate: rate,
      lockExpiresAt,
      fees: { feePayMinor: '0', feeReceiveMinor: '0' }
    };
    QUOTES.set(quoteId, stored);
    return stored;
  };

  const findQuote = (quoteId) => QUOTES.get(quoteId) || null;

  const instruct = ({ quoteId, originator, beneficiary, travelRule, payAmount, receiveAmount }) => {
    const q = QUOTES.get(quoteId);
    if (!q) {
      throw new AppError('NOT_FOUND', `simulator quote ${quoteId} not found`, 404);
    }
    if (new Date(q.lockExpiresAt).getTime() <= Date.now()) {
      throw new AppError('CONFLICT', `simulator quote ${quoteId} expired`, 409);
    }
    const beneficiaryAccountId = beneficiary?.accountId || '';
    const force = FORCE_ACCOUNT_BEHAVIORS[beneficiaryAccountId];
    const foreignTxId = uuidv7();
    const baseRecord = {
      foreignTxId,
      quoteId,
      originator,
      beneficiary,
      travelRule,
      payAmount: payAmount || q.payAmount,
      receiveAmount: receiveAmount || q.receiveAmount,
      status: 'ACCEPTED',
      reasonCode: null,
      settledAt: new Date().toISOString(),
      beneficiaryRef: `SIMFR-${foreignTxId.slice(0, 8)}`
    };

    if (!force || force.behavior === 'SUCCESS') {
      TXS.set(foreignTxId, { ...baseRecord, status: 'ACCEPTED' });
      return { foreignTxId, status: 'ACCEPTED', reasonCode: null };
    }
    if (force.behavior === 'REJECT_AC04') {
      TXS.set(foreignTxId, { ...baseRecord, status: 'REJECTED', reasonCode: force.reasonCode, message: force.message });
      return { foreignTxId, status: 'REJECTED', reasonCode: force.reasonCode, message: force.message };
    }
    if (force.behavior === 'TIMEOUT') {
      // Throw to simulate a network timeout. Caller is expected to handle.
      throw new AppError('TIMEOUT', 'simulator timed out', 504);
    }
    if (force.behavior === 'ASYNC_SUCCESS') {
      // Return ACCEPTED but mark internal state pending; status() reflects
      // PENDING for delayMs then SETTLED. The "delay" is virtual: we simply
      // store the planned settlement time; status() compares against now().
      const settledAt = new Date(Date.now() + force.delayMs).toISOString();
      TXS.set(foreignTxId, { ...baseRecord, status: 'PENDING', settledAt });
      return { foreignTxId, status: 'ACCEPTED', reasonCode: null, async: true };
    }
    // Unknown force: success.
    TXS.set(foreignTxId, baseRecord);
    return { foreignTxId, status: 'ACCEPTED', reasonCode: null };
  };

  const status = ({ foreignTxId }) => {
    const tx = TXS.get(foreignTxId);
    if (!tx) {
      throw new AppError('NOT_FOUND', `simulator tx ${foreignTxId} not found`, 404);
    }
    if (tx.status === 'PENDING' && new Date(tx.settledAt).getTime() <= Date.now()) {
      tx.status = 'ACCEPTED';
    }
    return {
      foreignTxId,
      status: tx.status,
      settledAt: tx.status === 'ACCEPTED' ? tx.settledAt : null,
      beneficiaryRef: tx.beneficiaryRef,
      reasonCode: tx.reasonCode || null
    };
  };

  const freeze = ({ foreignTxId, reason }) => {
    const tx = TXS.get(foreignTxId);
    if (!tx) {
      throw new AppError('NOT_FOUND', `simulator tx ${foreignTxId} not found`, 404);
    }
    tx.frozen = true;
    tx.frozenReason = reason;
    return { foreignTxId, frozen: true };
  };

  const reverse = ({ foreignTxId, reason }) => {
    const tx = TXS.get(foreignTxId);
    if (!tx) {
      throw new AppError('NOT_FOUND', `simulator tx ${foreignTxId} not found`, 404);
    }
    tx.reversed = true;
    tx.reversalReason = reason;
    tx.status = 'REVERSED';
    return { foreignTxId, reversed: true, reversedAt: new Date().toISOString() };
  };

  return { quote, findQuote, instruct, status, freeze, reverse };
};
