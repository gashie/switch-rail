import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { convertMinor } from '../../core/money.js';
import { config } from '../../core/config.js';
import { auditService } from '../audit/index.js';
import { QUOTE_STATES } from './codes.js';
import { requireMakerFactory } from './maker-client.js';

const pairKey = (a, b) => `${a}/${b}`;

// Slippage check: compare two decimal-string rates by computing the relative
// drift in basis points. Both rates must be > 0.
export const slippageBps = (oldRate, newRate) => {
  // Use BigInt math by aligning fractional digits.
  const [oI, oF = ''] = oldRate.split('.');
  const [nI, nF = ''] = newRate.split('.');
  const scale = Math.max(oF.length, nF.length);
  const oM = BigInt(oI + oF.padEnd(scale, '0'));
  const nM = BigInt(nI + nF.padEnd(scale, '0'));
  if (oM === 0n) return Number.MAX_SAFE_INTEGER;
  // |new - old| / old * 10000 (bps).
  const diff = nM > oM ? nM - oM : oM - nM;
  // We want a Number result; safe because rates are bounded.
  const bps = Number((diff * 10000n) / oM);
  return bps;
};

export const createQuoteService = ({ db, model }) => {
  // Find a market maker that supports the requested pair. Pulls from DB so
  // operators can register new makers at runtime.
  const findMaker = (client, pair) => model.findActiveMakerForPair(client, pair);

  const quote = async ({ payCurrency, receiveCurrency, payAmount }) => {
    if (!payCurrency || !receiveCurrency) {
      throw new AppError('VALIDATION_FAILED', 'payCurrency and receiveCurrency required', 400);
    }
    const pair = pairKey(payCurrency, receiveCurrency);
    return db.withTransaction(async (client) => {
      const maker = await findMaker(client, pair);
      if (!maker) {
        throw new AppError('NOT_FOUND', `no FX maker supports pair ${pair}`, 404);
      }
      const factory = requireMakerFactory();
      const makerClient = factory({ maker });
      const rateResult = await makerClient.quote({
        payCurrency,
        receiveCurrency,
        payAmount,
        feePayMinor: '0'
      });
      // (payAmount - feePay) * rate, applying the conversion to receive currency minor units.
      const netPayMinor = BigInt(payAmount) - BigInt(rateResult.feePayMinor || '0');
      if (netPayMinor <= 0n) {
        throw new AppError('VALIDATION_FAILED', 'payAmount net of fees must be > 0', 400);
      }
      const receiveAmountMinor = convertMinor({
        payMinor: netPayMinor,
        payCurrency,
        receiveCurrency,
        rate: rateResult.rateDecimalStr
      }) - BigInt(rateResult.feeReceiveMinor || '0');
      if (receiveAmountMinor <= 0n) {
        throw new AppError('VALIDATION_FAILED', 'receive amount after fees must be > 0', 400);
      }
      const id = uuidv7();
      const expiresAt = new Date(Date.now() + config.fxLockSeconds * 1000).toISOString();
      const inserted = await model.insertQuote(client, {
        id,
        payCurrency,
        receiveCurrency,
        payAmountMinor: String(payAmount),
        receiveAmountMinor: String(receiveAmountMinor),
        rateDecimalStr: rateResult.rateDecimalStr,
        marketMakerId: maker.id,
        feePayMinor: rateResult.feePayMinor || '0',
        feeReceiveMinor: rateResult.feeReceiveMinor || '0',
        expiresAt,
        metadata: { makerCode: maker.maker_code }
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'fx.quoted',
        resourceType: 'fx_quote',
        resourceId: id,
        payload: { pair, payAmount: String(payAmount), rateDecimalStr: rateResult.rateDecimalStr }
      });
      return inserted;
    });
  };

  const findById = (id) => db.withClient((c) => model.findQuoteById(c, id));

  const lock = async (id) => {
    // Pre-check expiration in its own transaction so the EXPIRED transition
    // commits even when we throw to surface the error.
    const pre = await db.withClient((c) => model.findQuoteById(c, id));
    if (!pre) throw new AppError('NOT_FOUND', `quote ${id} not found`, 404);
    if (new Date(pre.expires_at).getTime() <= Date.now()) {
      await db.withTransaction((c) => model.setQuoteState(c, { id, toState: QUOTE_STATES.EXPIRED }));
      throw new AppError('CONFLICT', 'quote expired', 409);
    }
    return db.withTransaction(async (client) => {
      const q = await model.findQuoteById(client, id);
      if (q.state !== QUOTE_STATES.OPEN) {
        throw new AppError('CONFLICT', `lock requires OPEN, got ${q.state}`, 409);
      }
      const updated = await model.setQuoteState(client, { id, toState: QUOTE_STATES.LOCKED });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'fx.locked',
        resourceType: 'fx_quote',
        resourceId: id,
        payload: { pair: pairKey(q.pay_currency, q.receive_currency) }
      });
      return updated;
    });
  };

  // Verify the quote is OPEN/LOCKED, not expired, and its rate hasn't drifted
  // beyond the slippage budget. Returns the row if all good; throws otherwise.
  // Designed to be called from inside the parent transaction (PvP coordinator).
  const verifyAndConsumeOnClient = async (client, { quoteId, transactionId }) => {
    const q = await model.findQuoteById(client, quoteId);
    if (!q) throw new AppError('NOT_FOUND', `quote ${quoteId} not found`, 404);
    if (q.state === QUOTE_STATES.CONSUMED) {
      // Idempotent: if already consumed for this transaction, return it.
      if (q.consumed_transaction_id === transactionId) return q;
      throw new AppError('CONFLICT', `quote ${quoteId} already consumed`, 409);
    }
    if (q.state !== QUOTE_STATES.OPEN && q.state !== QUOTE_STATES.LOCKED) {
      throw new AppError('CONFLICT', `quote ${quoteId} is in state ${q.state}`, 409);
    }
    if (new Date(q.expires_at).getTime() <= Date.now()) {
      await model.setQuoteState(client, { id: quoteId, toState: QUOTE_STATES.EXPIRED });
      throw new AppError('CONFLICT', 'FX_QUOTE_EXPIRED', 409);
    }
    // Slippage check: re-fetch the maker rate and compare.
    const pair = pairKey(q.pay_currency, q.receive_currency);
    const maker = await findMaker(client, pair);
    if (maker) {
      const factory = requireMakerFactory();
      const current = await factory({ maker }).quote({
        payCurrency: q.pay_currency,
        receiveCurrency: q.receive_currency,
        payAmount: String(q.pay_amount_minor),
        feePayMinor: '0'
      });
      const drift = slippageBps(q.rate_decimal_str, current.rateDecimalStr);
      if (drift > config.fxSlippageBps) {
        await model.setQuoteState(client, { id: quoteId, toState: QUOTE_STATES.REJECTED_SLIPPAGE });
        throw new AppError(
          'CONFLICT',
          `SLIPPAGE_EXCEEDED: rate drifted ${drift}bps (cap ${config.fxSlippageBps})`,
          409,
          { lockedRate: q.rate_decimal_str, currentRate: current.rateDecimalStr, driftBps: drift }
        );
      }
    }
    const updated = await model.setQuoteState(client, {
      id: quoteId,
      toState: QUOTE_STATES.CONSUMED,
      fields: { consumed_transaction_id: transactionId }
    });
    await auditService.record(client, {
      actorType: 'system',
      eventType: 'fx.consumed',
      resourceType: 'fx_quote',
      resourceId: quoteId,
      payload: { transactionId }
    });
    return updated;
  };

  const expirePastDue = async () =>
    db.withTransaction(async (client) => {
      const expired = await model.expirePastDue(client, 500);
      for (const e of expired) {
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'fx.expired',
          resourceType: 'fx_quote',
          resourceId: e.id,
          payload: {}
        });
      }
      return { count: expired.length };
    });

  // Maker registry helpers (admin).
  const registerMaker = (input) =>
    db.withTransaction(async (client) => {
      const id = uuidv7();
      const inserted = await model.insertMaker(client, { id, ...input });
      if (!inserted) {
        throw new AppError('CONFLICT', `maker ${input.makerCode} already registered`, 409);
      }
      return inserted;
    });

  const listMakers = () => db.withClient((c) => model.listMakers(c));

  return {
    quote,
    findById,
    lock,
    verifyAndConsumeOnClient,
    expirePastDue,
    registerMaker,
    listMakers
  };
};
