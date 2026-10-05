import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import {
  settlementAssetsService,
  setCbdcForceFail,
  setStablecoinForceFail,
  listRegistered
} from '../index.js';

const cleanup = async () => {
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'settlement_asset.%'`);
};

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await cleanup();
  setCbdcForceFail(false);
  setStablecoinForceFail(false);
});

const baseInput = (overrides = {}) => ({
  payAmountMinor: '10000',
  payCurrency: 'GHS',
  receiveAmountMinor: '154200',
  receiveCurrency: 'NGN',
  foreignRailCode: 'PAPSS_FAKE',
  ...overrides
});

describe('settlement-assets — adapter registry', () => {
  it('registers all three default adapters at module load', () => {
    const adapters = listRegistered();
    expect(adapters).toContain('LOCAL_CURRENCY_NET');
    expect(adapters).toContain('CBDC');
    expect(adapters).toContain('STABLECOIN');
  });
});

describe('settlement-assets — LOCAL_CURRENCY_NET', () => {
  it('returns ok with a settlement reference', async () => {
    const r = await settlementAssetsService.settle(baseInput({ assetType: 'LOCAL_CURRENCY_NET' }));
    expect(r.ok).toBe(true);
    expect(r.settlementRef).toMatch(/^LOCAL-/);
  });
});

describe('settlement-assets — CBDC fake', () => {
  it('settles successfully and writes audit', async () => {
    const r = await settlementAssetsService.settle(baseInput({ assetType: 'CBDC' }));
    expect(r.ok).toBe(true);
    expect(r.settlementRef).toMatch(/^CBDC-/);
    const audit = await query(`SELECT event_type FROM audit_events WHERE event_type = 'settlement_asset.settled'`);
    expect(audit.rows.length).toBe(1);
  });

  it('forces failure path returns ok=false', async () => {
    setCbdcForceFail(true);
    const r = await settlementAssetsService.settle(baseInput({ assetType: 'CBDC' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('CBDC_NODE_UNREACHABLE');
    const audit = await query(`SELECT event_type FROM audit_events WHERE event_type = 'settlement_asset.failed'`);
    expect(audit.rows.length).toBe(1);
  });
});

describe('settlement-assets — STABLECOIN fake', () => {
  it('settles successfully', async () => {
    const r = await settlementAssetsService.settle(baseInput({ assetType: 'STABLECOIN' }));
    expect(r.ok).toBe(true);
    expect(r.settlementRef).toMatch(/^SC-/);
  });

  it('forces failure', async () => {
    setStablecoinForceFail(true);
    const r = await settlementAssetsService.settle(baseInput({ assetType: 'STABLECOIN' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('STABLECOIN_ISSUER_DEGRADED');
  });
});

describe('settlement-assets — unknown asset', () => {
  it('rejects unknown assetType', async () => {
    await expect(
      settlementAssetsService.settle(baseInput({ assetType: 'UNKNOWN' }))
    ).rejects.toThrow(/no settlement-asset client/);
  });
});
