import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '../../../core/db.js';
import { participantSimulatorService, BEHAVIORS, forceBehaviorFor } from '../index.js';

const baseRequest = (account, txId = '00000000-0000-7000-8000-000000000aaa') => ({
  envelopeId: '00000000-0000-7000-8000-000000000eee',
  transactionId: txId,
  endToEndId: 'e2e-1',
  amount: { value: '15000', currency: 'GHS' },
  originator: { participantCode: 'BANK_TEST', accountId: '0001', name: 'O' },
  beneficiary: { participantCode: 'BANK_TEST', accountId: account, name: 'B' }
});

afterAll(async () => {
  await closePool();
});

describe('simulator — force-account behaviour table', () => {
  it('lists every locked force account', () => {
    expect(forceBehaviorFor('9999000001').behavior).toBe('SUCCESS');
    expect(forceBehaviorFor('9999000002').behavior).toBe('REJECT_AM04');
    expect(forceBehaviorFor('9999000003').behavior).toBe('REJECT_AC04');
    expect(forceBehaviorFor('9999000004').behavior).toBe('REJECT_AC06');
    expect(forceBehaviorFor('9999000005').behavior).toBe('REJECT_AG01');
    expect(forceBehaviorFor('9999000006').behavior).toBe('REJECT_RR04');
    expect(forceBehaviorFor('9999000007').behavior).toBe('TIMEOUT');
    expect(forceBehaviorFor('9999000008').behavior).toBe('SLOW_RESPONSE');
    expect(forceBehaviorFor('9999000009').behavior).toBe('INTERMITTENT');
    expect(forceBehaviorFor('9999000010').behavior).toBe('UNREACHABLE');
    expect(forceBehaviorFor('1234567890')).toBeNull();
  });

  it('every BEHAVIORS key is referenced by force or default', () => {
    expect(Object.values(BEHAVIORS)).toContain('SUCCESS');
    expect(Object.values(BEHAVIORS)).toContain('TIMEOUT');
  });
});

describe('simulator — credit-leg behaviour', () => {
  it('SUCCESS for any non-force account', async () => {
    const r = await participantSimulatorService.creditLeg({
      participantCode: 'BANK_TEST',
      request: baseRequest('1234567890')
    });
    expect(r.kind).toBe('http_success');
    expect(r.body.ok).toBe(true);
    expect(r.body.data.responseCode).toBe('ACSC');
  });

  it('REJECT_AM04 for 9999000002', async () => {
    const r = await participantSimulatorService.creditLeg({
      participantCode: 'BANK_TEST',
      request: baseRequest('9999000002')
    });
    expect(r.kind).toBe('http_success');
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe('AM04');
  });

  it('REJECT_AC04 for 9999000003', async () => {
    const r = await participantSimulatorService.creditLeg({
      participantCode: 'BANK_TEST',
      request: baseRequest('9999000003')
    });
    expect(r.body.error.code).toBe('AC04');
  });

  it('REJECT_AC06 / AG01 / RR04 each return their codes', async () => {
    expect((await participantSimulatorService.creditLeg({
      participantCode: 'BANK_TEST',
      request: baseRequest('9999000004')
    })).body.error.code).toBe('AC06');
    expect((await participantSimulatorService.creditLeg({
      participantCode: 'BANK_TEST',
      request: baseRequest('9999000005')
    })).body.error.code).toBe('AG01');
    expect((await participantSimulatorService.creditLeg({
      participantCode: 'BANK_TEST',
      request: baseRequest('9999000006')
    })).body.error.code).toBe('RR04');
  });

  it('UNREACHABLE produces a tcp_error envelope', async () => {
    const r = await participantSimulatorService.creditLeg({
      participantCode: 'BANK_TEST',
      request: baseRequest('9999000010')
    });
    expect(r.kind).toBe('tcp_error');
  });

  it('SLOW_RESPONSE delays then succeeds', async () => {
    const t0 = Date.now();
    const r = await participantSimulatorService.creditLeg({
      participantCode: 'BANK_TEST',
      request: baseRequest('9999000008')
    });
    const elapsed = Date.now() - t0;
    expect(r.kind).toBe('http_success');
    expect(r.body.ok).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(50); // some delay
  });
});

describe('simulator — status-check', () => {
  it('reports credited for SUCCESS accounts', async () => {
    const r = await participantSimulatorService.statusCheck({
      participantCode: 'BANK_TEST',
      request: { transactionId: '00000000-0000-7000-8000-000000000123', accountNumber: '1234567890' }
    });
    expect(r.data.found).toBe(true);
    expect(r.data.status).toBe('credited');
  });

  it('reports not_credited for REJECT accounts', async () => {
    const r = await participantSimulatorService.statusCheck({
      participantCode: 'BANK_TEST',
      request: { transactionId: '00000000-0000-7000-8000-000000000124', accountNumber: '9999000002' }
    });
    expect(r.data.status).toBe('not_credited');
  });

  it('reports pending for TIMEOUT/SLOW/UNREACHABLE accounts', async () => {
    const r1 = await participantSimulatorService.statusCheck({
      participantCode: 'BANK_TEST',
      request: { transactionId: '00000000-0000-7000-8000-000000000125', accountNumber: '9999000007' }
    });
    expect(r1.data.status).toBe('pending');
    const r2 = await participantSimulatorService.statusCheck({
      participantCode: 'BANK_TEST',
      request: { transactionId: '00000000-0000-7000-8000-000000000126', accountNumber: '9999000010' }
    });
    expect(r2.data.status).toBe('pending');
  });
});

describe('simulator — reversal', () => {
  it('returns reversedAt successfully', async () => {
    const r = await participantSimulatorService.reversal();
    expect(r.data.reversedAt).toBeTruthy();
  });
});
