import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { participantsService } from '../../participants/index.js';
import {
  foreignRailsService,
  foreignRailsSimulator,
  _resetSimulatorState
} from '../index.js';

const RAIL_PARTICIPANT = 'XB_FOREIGN_TEST';

const cleanup = async () => {
  await query(`DELETE FROM foreign_rails`);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id = $1`, [RAIL_PARTICIPANT]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'foreign_rail.%'`);
  await query(`DELETE FROM participants WHERE code = $1`, [RAIL_PARTICIPANT]);
};

beforeAll(async () => {
  await cleanup();
  await participantsService.create({
    code: RAIL_PARTICIPANT,
    name: 'Foreign Rail Test',
    legalName: 'Foreign Rail Test PLC',
    type: 'FOREIGN_RAIL',
    countryCode: 'GH'
  });
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM foreign_rails`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'foreign_rail.%'`);
  _resetSimulatorState();
});

const sampleEndpoints = (railCode) => ({
  quote: `http://localhost:9999/simulator-foreign/${railCode}/quote`,
  instruct: `http://localhost:9999/simulator-foreign/${railCode}/instruct`,
  status: `http://localhost:9999/simulator-foreign/${railCode}/status`,
  freeze: `http://localhost:9999/simulator-foreign/${railCode}/freeze`,
  reverse: `http://localhost:9999/simulator-foreign/${railCode}/reverse`
});

describe('crossborder-rails — registry', () => {
  it('register a foreign rail (FOREIGN_RAIL participant) succeeds', async () => {
    const r = await foreignRailsService.register({
      railCode: 'PAPSS_TEST',
      railName: 'PAPSS Test',
      railType: 'MULTILATERAL_HUB',
      participantCode: RAIL_PARTICIPANT,
      supportedCurrencies: ['NGN', 'KES'],
      supportedCountries: ['NG', 'KE'],
      settlementModel: 'NET_DAILY',
      cutoverTimeUtc: '11:00:00',
      endpoints: sampleEndpoints('PAPSS_TEST')
    });
    expect(r.rail_code).toBe('PAPSS_TEST');
    expect(r.active).toBe(true);
  });

  it('register fails when participant is not FOREIGN_RAIL type', async () => {
    await participantsService.create({
      code: 'XB_BANK_NOT_RAIL',
      name: 'X', legalName: 'X PLC', type: 'BANK', countryCode: 'GH'
    });
    await expect(
      foreignRailsService.register({
        railCode: 'WRONG_TYPE',
        railName: 'Wrong Type',
        railType: 'BILATERAL',
        participantCode: 'XB_BANK_NOT_RAIL',
        supportedCurrencies: ['NGN'],
        supportedCountries: ['NG'],
        settlementModel: 'GROSS_INSTANT',
        endpoints: sampleEndpoints('WRONG_TYPE')
      })
    ).rejects.toThrow(/FOREIGN_RAIL/);
    await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id = 'XB_BANK_NOT_RAIL'`);
    await query(`DELETE FROM participants WHERE code = 'XB_BANK_NOT_RAIL'`);
  });

  it('find returns rails matching country + currency', async () => {
    await foreignRailsService.register({
      railCode: 'PAPSS_NG',
      railName: 'PAPSS', railType: 'MULTILATERAL_HUB',
      participantCode: RAIL_PARTICIPANT,
      supportedCurrencies: ['NGN'], supportedCountries: ['NG'],
      settlementModel: 'NET_DAILY',
      endpoints: sampleEndpoints('PAPSS_NG')
    });
    await foreignRailsService.register({
      railCode: 'PESALINK_KE',
      railName: 'PesaLink', railType: 'BILATERAL',
      participantCode: RAIL_PARTICIPANT,
      supportedCurrencies: ['KES'], supportedCountries: ['KE'],
      settlementModel: 'GROSS_INSTANT',
      endpoints: sampleEndpoints('PESALINK_KE')
    });
    const ng = await foreignRailsService.findForCountryCurrency({ country: 'NG', currency: 'NGN' });
    expect(ng.length).toBe(1);
    expect(ng[0].rail_code).toBe('PAPSS_NG');
    const ke = await foreignRailsService.findForCountryCurrency({ country: 'KE', currency: 'KES' });
    expect(ke.length).toBe(1);
    expect(ke[0].rail_code).toBe('PESALINK_KE');
  });

  it('setActive flips the active flag', async () => {
    await foreignRailsService.register({
      railCode: 'TOGGLE',
      railName: 'Toggle', railType: 'BILATERAL',
      participantCode: RAIL_PARTICIPANT,
      supportedCurrencies: ['USD'], supportedCountries: ['US'],
      settlementModel: 'GROSS_INSTANT',
      endpoints: sampleEndpoints('TOGGLE')
    });
    const off = await foreignRailsService.setActive({ railCode: 'TOGGLE', active: false });
    expect(off.active).toBe(false);
  });
});

describe('crossborder-rails — simulator', () => {
  it('quote → instruct → status round-trip for SUCCESS account', () => {
    const q = foreignRailsSimulator.quote({
      payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '10000'
    });
    expect(q.lockedRate).toBe('15.42');
    const i = foreignRailsSimulator.instruct({
      quoteId: q.quoteId,
      originator: { name: 'Kofi' },
      beneficiary: { accountId: '9999100001' },
      travelRule: { purpose: 'REMITTANCE_FAMILY' }
    });
    expect(i.status).toBe('ACCEPTED');
    const s = foreignRailsSimulator.status({ foreignTxId: i.foreignTxId });
    expect(s.status).toBe('ACCEPTED');
    expect(s.beneficiaryRef).toMatch(/^SIMFR-/);
  });

  it('force-fail account 9999100002 returns REJECTED with AC04', () => {
    const q = foreignRailsSimulator.quote({ payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '5000' });
    const i = foreignRailsSimulator.instruct({
      quoteId: q.quoteId,
      originator: {},
      beneficiary: { accountId: '9999100002' },
      travelRule: {}
    });
    expect(i.status).toBe('REJECTED');
    expect(i.reasonCode).toBe('AC04');
  });

  it('timeout force-account 9999100007 throws TIMEOUT', () => {
    const q = foreignRailsSimulator.quote({ payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '5000' });
    expect(() =>
      foreignRailsSimulator.instruct({
        quoteId: q.quoteId,
        originator: {},
        beneficiary: { accountId: '9999100007' },
        travelRule: {}
      })
    ).toThrow(/timed out/);
  });

  it('async-success account returns ACCEPTED but PENDING in status until time elapses', () => {
    const q = foreignRailsSimulator.quote({ payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '5000' });
    const i = foreignRailsSimulator.instruct({
      quoteId: q.quoteId,
      originator: {},
      beneficiary: { accountId: '9999100009' },
      travelRule: {}
    });
    expect(i.status).toBe('ACCEPTED');
    expect(i.async).toBe(true);
    const sBefore = foreignRailsSimulator.status({ foreignTxId: i.foreignTxId });
    expect(sBefore.status).toBe('PENDING');
  });
});
