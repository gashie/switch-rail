import { describe, expect, it } from 'vitest';
import {
  createAuthorizationService,
  PIPELINE,
  duplicates,
  accountStatus,
  sanctions,
  fraud,
  limits,
  liquidity,
  DEFAULT_DAILY_CAP_MINOR,
  DEFAULT_MONTHLY_CAP_MINOR
} from '../index.js';

const baseCtx = (overrides = {}) => ({
  transaction: {
    id: 'tx-uuid',
    originator_participant: 'BANK01',
    beneficiary_participant: 'BANK02',
    amount_value: '15000',
    amount_currency: 'GHS',
    end_to_end_id: 'e2e-1'
  },
  originatorAccount: { id: 'acct-orig', status: 'active' },
  beneficiaryAccount: { id: 'acct-bene', status: 'active' },
  recentMatchingE2E: [],
  dailyVolumeMinor: 0n,
  monthlyVolumeMinor: 0n,
  dailyCapMinor: DEFAULT_DAILY_CAP_MINOR,
  monthlyCapMinor: DEFAULT_MONTHLY_CAP_MINOR,
  ...overrides
});

describe('authorization — pipeline order', () => {
  it('locks the order: duplicates → account-status → sanctions → fraud → limits → liquidity', () => {
    expect(PIPELINE.map((p) => p.name)).toEqual([
      'duplicates',
      'account-status',
      'sanctions',
      'fraud',
      'limits',
      'liquidity'
    ]);
  });
});

describe('authorization — happy path', () => {
  it('returns ok:true when all checks pass', async () => {
    const service = createAuthorizationService();
    const r = await service.authorize(baseCtx());
    expect(r.ok).toBe(true);
  });
});

describe('authorization — individual checks', () => {
  it('duplicates rejects when prior e2e exists in window', () => {
    const r = duplicates({ recentMatchingE2E: [{ id: 'older-tx' }] });
    expect(r.pass).toBe(false);
    expect(r.code).toBe('DUPLICATE');
  });

  it('duplicates passes when no prior e2e seen', () => {
    expect(duplicates({ recentMatchingE2E: [] }).pass).toBe(true);
  });

  it('account-status: rejects missing originator with INVALID_END_CUSTOMER', () => {
    const r = accountStatus({
      originatorAccount: null,
      beneficiaryAccount: { status: 'active' }
    });
    expect(r).toMatchObject({ pass: false, code: 'INVALID_END_CUSTOMER' });
  });

  it('account-status: rejects missing beneficiary with BENEFICIARY_ACCOUNT_NOT_FOUND', () => {
    const r = accountStatus({
      originatorAccount: { status: 'active' },
      beneficiaryAccount: null
    });
    expect(r).toMatchObject({ pass: false, code: 'BENEFICIARY_ACCOUNT_NOT_FOUND' });
  });

  it('account-status: rejects closed beneficiary with BENEFICIARY_ACCOUNT_CLOSED', () => {
    const r = accountStatus({
      originatorAccount: { status: 'active' },
      beneficiaryAccount: { status: 'closed' }
    });
    expect(r).toMatchObject({ pass: false, code: 'BENEFICIARY_ACCOUNT_CLOSED' });
  });

  it('account-status: rejects frozen beneficiary with BENEFICIARY_ACCOUNT_BLOCKED', () => {
    const r = accountStatus({
      originatorAccount: { status: 'active' },
      beneficiaryAccount: { status: 'frozen' }
    });
    expect(r).toMatchObject({ pass: false, code: 'BENEFICIARY_ACCOUNT_BLOCKED' });
  });

  it('limits: rejects when projected daily exceeds cap', () => {
    const r = limits({
      transaction: { amount_value: '50000000' },
      dailyVolumeMinor: 60_000_000n,
      monthlyVolumeMinor: 0n,
      dailyCapMinor: DEFAULT_DAILY_CAP_MINOR,
      monthlyCapMinor: DEFAULT_MONTHLY_CAP_MINOR
    });
    expect(r).toMatchObject({ pass: false, code: 'TRANSACTION_FORBIDDEN' });
  });

  it('limits: rejects when projected monthly exceeds cap even with daily ok', () => {
    const r = limits({
      transaction: { amount_value: '500000000' },
      dailyVolumeMinor: 0n,
      monthlyVolumeMinor: 2_900_000_000n,
      dailyCapMinor: DEFAULT_DAILY_CAP_MINOR,
      monthlyCapMinor: DEFAULT_MONTHLY_CAP_MINOR
    });
    expect(r).toMatchObject({ pass: false, code: 'TRANSACTION_FORBIDDEN' });
  });

  it('limits: passes within cap', () => {
    const r = limits({
      transaction: { amount_value: '15000' },
      dailyVolumeMinor: 100n,
      monthlyVolumeMinor: 100n
    });
    expect(r.pass).toBe(true);
  });

  it('limits: respects per-participant override caps from ctx', () => {
    const r = limits({
      transaction: { amount_value: '101' },
      dailyVolumeMinor: 0n,
      monthlyVolumeMinor: 0n,
      dailyCapMinor: 100n,
      monthlyCapMinor: 1_000_000n
    });
    expect(r).toMatchObject({ pass: false, code: 'TRANSACTION_FORBIDDEN' });
  });

  it('sanctions: returns pass with framework metadata (Phase 6 fills)', () => {
    const r = sanctions({
      transaction: {
        originator_participant: 'BANK01',
        beneficiary_participant: 'BANK02'
      }
    });
    expect(r.pass).toBe(true);
    expect(r.framework.originatorScreened).toBe('BANK01');
  });

  it('fraud: returns pass with score 0 (Phase 6 fills)', () => {
    expect(fraud()).toMatchObject({ pass: true, score: 0 });
  });

  it('liquidity: returns pass (Phase 5 fills)', () => {
    expect(liquidity()).toEqual({ pass: true, position: null });
  });
});

describe('authorization — short-circuit', () => {
  it('returns the first failing check and stops', async () => {
    const service = createAuthorizationService();
    // Both duplicates and limits would fail; duplicates runs first so it
    // wins.
    const r = await service.authorize(
      baseCtx({
        recentMatchingE2E: [{ id: 'older' }],
        dailyVolumeMinor: 200_000_000n
      })
    );
    expect(r.ok).toBe(false);
    expect(r.check).toBe('duplicates');
    expect(r.code).toBe('DUPLICATE');
  });

  it('reaches limits when account-status passes and earlier checks pass', async () => {
    const service = createAuthorizationService();
    const r = await service.authorize(
      baseCtx({
        dailyVolumeMinor: 200_000_000n
      })
    );
    expect(r.ok).toBe(false);
    expect(r.check).toBe('limits');
    expect(r.code).toBe('TRANSACTION_FORBIDDEN');
  });
});
