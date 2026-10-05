import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { convertMinor } from '../../../core/money.js';
import {
  crossborderFxService,
  QUOTE_STATES,
  clearRateOverrides,
  slippageBps
} from '../index.js';

const cleanup = async () => {
  await query(`DELETE FROM fx_quotes`);
  await query(`DELETE FROM fx_market_makers`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'fx.%'`);
};

const seedMaker = async (code = 'FAKE_MAIN', priority = 100) => {
  return crossborderFxService.registerMaker({
    makerCode: code,
    makerName: code,
    supportedPairs: ['GHS/NGN', 'GHS/KES', 'GHS/USD', 'NGN/GHS'],
    endpoints: { quote: 'http://localhost:0/fake' },
    priority
  });
};

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM fx_quotes`);
  await query(`DELETE FROM fx_market_makers`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'fx.%'`);
  clearRateOverrides();
});

describe('core/money — convertMinor', () => {
  it('GHS 100.00 → NGN at rate 15.42 = 1542.00 NGN minor', () => {
    const out = convertMinor({
      payMinor: '10000',
      payCurrency: 'GHS',
      receiveCurrency: 'NGN',
      rate: '15.42'
    });
    expect(out).toBe(154200n);
  });

  it('GHS 100.00 → USD at rate 0.083 = 8.30 USD minor', () => {
    const out = convertMinor({
      payMinor: '10000',
      payCurrency: 'GHS',
      receiveCurrency: 'USD',
      rate: '0.083'
    });
    expect(out).toBe(830n);
  });

  it('GHS 100.00 → JPY at rate 30 (zero-decimal receive) = 3000 JPY minor', () => {
    const out = convertMinor({
      payMinor: '10000',
      payCurrency: 'GHS',
      receiveCurrency: 'JPY',
      rate: '30'
    });
    expect(out).toBe(3000n);
  });

  it('rounds half-down (truncates) for fractional results', () => {
    // 1 GHS minor = 0.01 GHS at rate 0.083 → 0.000083 USD = 0.0083 USD minor
    // BigInt floor = 0.
    const out = convertMinor({
      payMinor: '1',
      payCurrency: 'GHS',
      receiveCurrency: 'USD',
      rate: '0.083'
    });
    expect(out).toBe(0n);
  });

  it('rejects bad rate strings', () => {
    expect(() =>
      convertMinor({ payMinor: '100', payCurrency: 'GHS', receiveCurrency: 'NGN', rate: 'NaN' })
    ).toThrow(/invalid rate/);
  });
});

describe('crossborder-fx — quote happy path', () => {
  it('GHS→NGN at rate 15.42 with 100 GHS pay → 1542 NGN receive (minor units)', async () => {
    await seedMaker();
    const q = await crossborderFxService.quote({
      payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '10000'
    });
    expect(q.state).toBe(QUOTE_STATES.OPEN);
    expect(q.rate_decimal_str).toBe('15.42');
    expect(String(q.receive_amount_minor)).toBe('154200');
  });

  it('multiple makers: highest-priority (lowest priority number) wins', async () => {
    await seedMaker('LOWPRIO', 200);
    await seedMaker('HIGHPRIO', 50);
    const q = await crossborderFxService.quote({
      payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '5000'
    });
    expect(q.metadata.makerCode).toBe('HIGHPRIO');
  });
});

describe('crossborder-fx — lock + consume', () => {
  it('lock transitions OPEN → LOCKED', async () => {
    await seedMaker();
    const q = await crossborderFxService.quote({
      payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '5000'
    });
    const locked = await crossborderFxService.lock(q.id);
    expect(locked.state).toBe(QUOTE_STATES.LOCKED);
  });

  it('lock fails on already-LOCKED quote', async () => {
    await seedMaker();
    const q = await crossborderFxService.quote({ payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '5000' });
    await crossborderFxService.lock(q.id);
    await expect(crossborderFxService.lock(q.id)).rejects.toThrow(/lock requires OPEN/);
  });
});

describe('crossborder-fx — expiry', () => {
  it('lock fails on expired quote and marks EXPIRED', async () => {
    await seedMaker();
    const q = await crossborderFxService.quote({ payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '5000' });
    await query(`UPDATE fx_quotes SET expires_at = now() - interval '1 minute' WHERE id = $1`, [q.id]);
    await expect(crossborderFxService.lock(q.id)).rejects.toThrow(/expired/);
    const after = await crossborderFxService.findById(q.id);
    expect(after.state).toBe(QUOTE_STATES.EXPIRED);
  });

  it('expirePastDue worker batch-marks all expired open quotes', async () => {
    await seedMaker();
    const q1 = await crossborderFxService.quote({ payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '5000' });
    const q2 = await crossborderFxService.quote({ payCurrency: 'GHS', receiveCurrency: 'KES', payAmount: '5000' });
    await query(`UPDATE fx_quotes SET expires_at = now() - interval '1 minute' WHERE id IN ($1, $2)`, [q1.id, q2.id]);
    const out = await crossborderFxService.expirePastDue();
    expect(out.count).toBe(2);
  });
});

describe('crossborder-fx — slippage protection', () => {
  it('slippageBps math is correct', () => {
    expect(slippageBps('15.42', '15.42')).toBe(0);
    // 15.42 → 15.50 = +0.08 / 15.42 = ~52 bps
    expect(slippageBps('15.42', '15.50')).toBeGreaterThan(50);
    // 15.42 → 15.50 in the other direction
    expect(slippageBps('15.50', '15.42')).toBeGreaterThan(50);
    // 15.42 → 15.46 ≈ 26 bps
    expect(slippageBps('15.42', '15.46')).toBeLessThan(50);
  });
});
