import { describe, expect, it } from 'vitest';
import { createEnvelope } from '../index.js';

const futureIso = (ms = 60_000) => new Date(Date.now() + ms).toISOString();

const validXbInput = (overrides = {}) => ({
  msgType: 'XB_CRDT_TRF',
  sourceFormat: 'REST',
  endToEndId: 'xb-e2e-001',
  idempotencyKey: 'xb-idem-001-abcdefgh',
  originator: { participantCode: 'GH_BANK_A', accountId: '0AA0000001', accountType: 'BANK_ACCOUNT', name: 'Kofi Sender', countryCode: 'GH' },
  beneficiary: { participantCode: 'NG_RAIL_PAPSS', accountId: 'NG-PAPSS-9999100001', accountType: 'BANK_ACCOUNT', name: 'Adaeze Receiver', countryCode: 'NG' },
  amount: { value: '10000', currency: 'GHS' },
  crossBorder: {
    foreignRailCode: 'PAPSS_FAKE',
    originatorCountry: 'GH',
    beneficiaryCountry: 'NG',
    fx: {
      payCurrency: 'GHS',
      receiveCurrency: 'NGN',
      lockedRate: '15.42',
      lockedAt: new Date().toISOString(),
      lockExpiresAt: futureIso(),
      quoteId: '01900000-0000-7000-8000-000000000aaa',
      payAmount: '10000',
      receiveAmount: '154200'
    },
    travelRule: {
      originatorIdType: 'GHANACARD',
      originatorIdHashed: 'sha256:' + 'a'.repeat(64),
      originatorAddress: 'Accra, GH',
      originatorDateOfBirth: '1990-01-01',
      beneficiaryIdType: 'NATIONAL_ID',
      beneficiaryIdHashed: 'sha256:' + 'b'.repeat(64),
      beneficiaryAddress: 'Lagos, NG',
      purposeOfPayment: 'REMITTANCE_FAMILY',
      jurisdictionOfOriginator: 'GH',
      jurisdictionOfBeneficiary: 'NG'
    },
    settlementAssetType: 'LOCAL_CURRENCY_NET'
  },
  ...overrides
});

describe('envelope — cross-border (XB_CRDT_TRF)', () => {
  it('valid XB envelope ingests', () => {
    const env = createEnvelope(validXbInput());
    expect(env.msgType).toBe('XB_CRDT_TRF');
    expect(env.crossBorder.foreignRailCode).toBe('PAPSS_FAKE');
    expect(env.crossBorder.fx.lockedRate).toBe('15.42');
    expect(env.crossBorder.settlementAssetType).toBe('LOCAL_CURRENCY_NET');
  });

  it('rejects when crossBorder field is missing on XB_CRDT_TRF', () => {
    const i = validXbInput();
    delete i.crossBorder;
    expect(() => createEnvelope(i)).toThrow(/invalid envelope/);
  });

  it('rejects when travel rule field is missing', () => {
    const i = validXbInput();
    delete i.crossBorder.travelRule.purposeOfPayment;
    expect(() => createEnvelope(i)).toThrow(/invalid envelope/);
  });

  it('rejects when lockExpiresAt is in the past', () => {
    const i = validXbInput();
    i.crossBorder.fx.lockExpiresAt = '2020-01-01T00:00:00.000Z';
    expect(() => createEnvelope(i)).toThrow(/lockExpiresAt must be in the future/);
  });

  it('rejects invalid country code in travel rule', () => {
    const i = validXbInput();
    i.crossBorder.travelRule.jurisdictionOfOriginator = 'GHA'; // 3 chars
    expect(() => createEnvelope(i)).toThrow(/invalid envelope/);
  });

  it('rejects bad rate string', () => {
    const i = validXbInput();
    i.crossBorder.fx.lockedRate = 'NaN';
    expect(() => createEnvelope(i)).toThrow(/invalid envelope/);
  });

  it('rejects unknown ID type', () => {
    const i = validXbInput();
    i.crossBorder.travelRule.originatorIdType = 'DRIVERS_LICENSE';
    expect(() => createEnvelope(i)).toThrow(/invalid envelope/);
  });

  it('rejects crossBorder field on a non-XB msgType', () => {
    const i = validXbInput({ msgType: 'CRDT_TRF' });
    expect(() => createEnvelope(i)).toThrow(/invalid envelope/);
  });

  it('Phase 4 retroactive: existing CRDT_TRF envelope without crossBorder still ingests', () => {
    const env = createEnvelope({
      msgType: 'CRDT_TRF',
      sourceFormat: 'REST',
      endToEndId: 'plain-e2e',
      idempotencyKey: 'plain-idem-12345678',
      originator: { participantCode: 'GH_BANK_A', accountId: '0AA0000001', accountType: 'BANK_ACCOUNT', name: 'O' },
      beneficiary: { participantCode: 'GH_BANK_B', accountId: '0BB0000001', accountType: 'BANK_ACCOUNT', name: 'B' },
      amount: { value: '5000', currency: 'GHS' }
    });
    expect(env.msgType).toBe('CRDT_TRF');
    expect(env.crossBorder).toBeUndefined();
  });
});
