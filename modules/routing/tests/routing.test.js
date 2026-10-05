import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { participantsService } from '../../participants/index.js';
import { routingService } from '../index.js';

const A = 'RTBANK_A';
const B = 'RTBANK_B';
const C = 'RTWALLET';

const cleanup = async () => {
  await query(`DELETE FROM routing_rules WHERE participant_code IN ($1,$2,$3)`, [A, B, C]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'routing.%' OR event_type LIKE 'participant.%'`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2,$3)`, [A, B, C]);
  await query(`DELETE FROM participants WHERE code IN ($1,$2,$3)`, [A, B, C]);
};

beforeAll(async () => {
  await cleanup();
  await participantsService.create({ code: A, name: 'Bank A', legalName: 'Bank A PLC', type: 'BANK', bic: 'RTBKAGHACAA' });
  await participantsService.create({ code: B, name: 'Bank B', legalName: 'Bank B PLC', type: 'BANK', bic: 'RTBKBGHACBB' });
  await participantsService.create({ code: C, name: 'Wallet C', legalName: 'Wallet C Ltd', type: 'WALLET' });
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM routing_rules WHERE participant_code IN ($1,$2,$3)`, [A, B, C]);
  await routingService.reload();
});

describe('routing — direct participantCode', () => {
  it('returns the code as-is when given participantCode (no DB lookup)', async () => {
    const r = await routingService.resolve({ participantCode: 'ANYTHING' });
    expect(r.participantCode).toBe('ANYTHING');
    expect(r.ruleType).toBe('PARTICIPANT_CODE');
  });
});

describe('routing — BIN longest-prefix', () => {
  beforeEach(async () => {
    await routingService.addRule({ ruleType: 'BIN', pattern: '0123', participantCode: A, priority: 100 });
    await routingService.addRule({ ruleType: 'BIN', pattern: '0123456', participantCode: B, priority: 100 });
  });

  it('matches the longest pattern', async () => {
    const r = await routingService.resolve({ accountNumber: '0123456789' });
    expect(r.participantCode).toBe(B);
    expect(r.ruleType).toBe('BIN');
  });

  it('falls back to shorter pattern when longest does not match', async () => {
    const r = await routingService.resolve({ accountNumber: '0123999999' });
    expect(r.participantCode).toBe(A);
  });

  it('returns null when no BIN matches', async () => {
    const r = await routingService.resolve({ accountNumber: '9999000001' });
    expect(r).toBeNull();
  });
});

describe('routing — MSISDN longest-prefix', () => {
  beforeEach(async () => {
    await routingService.addRule({ ruleType: 'MSISDN_PREFIX', pattern: '233244', participantCode: C, priority: 100 });
    await routingService.addRule({ ruleType: 'MSISDN_PREFIX', pattern: '233', participantCode: A, priority: 100 });
  });

  it('strips a leading + before matching', async () => {
    const r = await routingService.resolve({ msisdn: '+233244111111' });
    expect(r.participantCode).toBe(C);
  });

  it('falls back to shorter prefix', async () => {
    const r = await routingService.resolve({ msisdn: '233500000001' });
    expect(r.participantCode).toBe(A);
  });
});

describe('routing — BIC exact', () => {
  beforeEach(async () => {
    await routingService.addRule({ ruleType: 'BIC', pattern: 'RTBKAGHACAA', participantCode: A, priority: 100 });
  });

  it('matches BIC exactly (case-insensitive on input)', async () => {
    const r = await routingService.resolve({ bic: 'rtbkaghacaa' });
    expect(r.participantCode).toBe(A);
    expect(r.ruleType).toBe('BIC');
  });

  it('returns null for unknown BIC', async () => {
    const r = await routingService.resolve({ bic: 'XXXXGHACXXX' });
    expect(r).toBeNull();
  });
});

describe('routing — hot reload + version stamp', () => {
  it('reload bumps version', async () => {
    const v0 = routingService.stats().version;
    const after = await routingService.reload();
    expect(after.version).toBe(v0 + 1);
  });

  it('addRule updates the cache so subsequent resolve sees the new rule', async () => {
    expect(await routingService.resolve({ accountNumber: '5555000001' })).toBeNull();
    await routingService.addRule({ ruleType: 'BIN', pattern: '5555', participantCode: A, priority: 100 });
    const r = await routingService.resolve({ accountNumber: '5555000001' });
    expect(r.participantCode).toBe(A);
  });

  it('removeRule updates the cache and removes resolution', async () => {
    const added = await routingService.addRule({
      ruleType: 'BIN',
      pattern: '6666',
      participantCode: A,
      priority: 100
    });
    expect((await routingService.resolve({ accountNumber: '6666999999' })).participantCode).toBe(A);
    await routingService.removeRule(added.rule.id);
    expect(await routingService.resolve({ accountNumber: '6666999999' })).toBeNull();
  });
});

describe('routing — list / priority', () => {
  it('listRules returns rules and they are sorted by priority asc, length desc', async () => {
    await routingService.addRule({ ruleType: 'BIN', pattern: '11', participantCode: A, priority: 50 });
    await routingService.addRule({ ruleType: 'BIN', pattern: '1234', participantCode: B, priority: 100 });
    const rules = await routingService.listRules({ ruleType: 'BIN' });
    expect(rules.length).toBe(2);
    expect(rules[0].priority).toBeLessThanOrEqual(rules[1].priority);
  });

  it('priority winner: lower priority number takes precedence even if shorter', async () => {
    await routingService.addRule({ ruleType: 'BIN', pattern: '1234', participantCode: A, priority: 10 });
    await routingService.addRule({ ruleType: 'BIN', pattern: '12345', participantCode: B, priority: 100 });
    const r = await routingService.resolve({ accountNumber: '12345999' });
    expect(r.participantCode).toBe(A);
  });
});
