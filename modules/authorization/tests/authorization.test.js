import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../../../core/uuid.js';
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
    id: uuidv7(),
    originator_participant: 'BANK01',
    beneficiary_participant: 'BANK02',
    originator_account: 'AUTHTESTACCT',
    beneficiary_account: 'AUTHTESTBENE',
    amount_value: '15000',
    amount_currency: 'GHS',
    end_to_end_id: 'e2e-1'
  },
  skipFraudPersistence: true,
  originatorAccount: { id: uuidv7(), status: 'active' },
  beneficiaryAccount: { id: uuidv7(), status: 'active' },
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

  it('fraud: returns pass with score 0 when called with no transaction', async () => {
    const r = await fraud({});
    expect(r).toMatchObject({ pass: true, score: 0 });
  });

  it('liquidity: returns pass when no limits configured', async () => {
    const r = await liquidity({
      transaction: {
        originator_participant: 'AUTHTESTNOLIM',
        amount_currency: 'GHS',
        amount_value: '1000'
      }
    });
    expect(r.pass).toBe(true);
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
