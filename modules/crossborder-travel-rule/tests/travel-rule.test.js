import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { sanctionsService } from '../../sanctions/index.js';
import { crossborderTravelRuleService } from '../index.js';

const validTravelRule = (overrides = {}) => ({
  originatorIdType: 'GHANACARD',
  originatorIdHashed: 'sha256:' + 'a'.repeat(64),
  originatorAddress: 'Accra, GH',
  originatorDateOfBirth: '1990-01-01',
  beneficiaryIdType: 'NATIONAL_ID',
  beneficiaryIdHashed: 'sha256:' + 'b'.repeat(64),
  beneficiaryAddress: 'Lagos, NG',
  purposeOfPayment: 'REMITTANCE_FAMILY',
  jurisdictionOfOriginator: 'GH',
  jurisdictionOfBeneficiary: 'NG',
  ...overrides
});

const validEnvelope = (overrides = {}) => ({
  originator: { name: 'Kofi Sender' },
  beneficiary: { name: 'Adaeze Receiver' },
  crossBorder: { travelRule: validTravelRule() },
  ...overrides
});

const cleanup = async () => {
  await query(`DELETE FROM travel_rule_records`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM watchlist_entries`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'travel_rule.%' OR event_type LIKE 'sanctions.%'`);
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
});

describe('crossborder-travel-rule — outbound enforcement', () => {
  it('persists a record when no sanctions hit', async () => {
    const r = await crossborderTravelRuleService.enforce({
      envelope: validEnvelope(),
      direction: 'OUTBOUND'
    });
    expect(r.direction).toBe('OUTBOUND');
    expect(r.sanctions_hit).toBe(false);
    expect(r.purpose_of_payment).toBe('REMITTANCE_FAMILY');
  });

  it('rejects when a required travel-rule field is missing', async () => {
    await expect(
      crossborderTravelRuleService.enforce({
        envelope: validEnvelope({
          crossBorder: { travelRule: { ...validTravelRule(), originatorAddress: '' } }
        }),
        direction: 'OUTBOUND'
      })
    ).rejects.toThrow(/originatorAddress/);
  });

  it('rejects on unknown ID type', async () => {
    await expect(
      crossborderTravelRuleService.enforce({
        envelope: validEnvelope({
          crossBorder: { travelRule: { ...validTravelRule(), beneficiaryIdType: 'WHATEVER' } }
        }),
        direction: 'OUTBOUND'
      })
    ).rejects.toThrow(/beneficiaryIdType/);
  });

  it('OFAC sanctions hit on beneficiary name → throws TRAVEL_RULE_SANCTIONS_HIT', async () => {
    await sanctionsService.seedFakeProviders();
    await expect(
      crossborderTravelRuleService.enforce({
        envelope: validEnvelope({
          beneficiary: { name: 'OSAMA TEST PERSON' }
        }),
        direction: 'OUTBOUND'
      })
    ).rejects.toThrow(/sanctions match/);
    // The record itself was persisted with sanctions_hit=true so regulators
    // can replay the audit.
    const records = await crossborderTravelRuleService.list({ direction: 'OUTBOUND' });
    expect(records.length).toBe(1);
    expect(records[0].sanctions_hit).toBe(true);
  });
});

describe('crossborder-travel-rule — inbound', () => {
  it('persists an INBOUND record from foreign-rail-supplied data', async () => {
    const r = await crossborderTravelRuleService.enforce({
      envelope: validEnvelope({
        originator: { name: 'Foreign Originator' },
        beneficiary: { name: 'Local Beneficiary' }
      }),
      direction: 'INBOUND'
    });
    expect(r.direction).toBe('INBOUND');
  });

  it('rejects an INBOUND record missing fields → TRAVEL_RULE_INCOMPLETE', async () => {
    await expect(
      crossborderTravelRuleService.enforce({
        envelope: validEnvelope({
          crossBorder: { travelRule: { ...validTravelRule(), purposeOfPayment: undefined } }
        }),
        direction: 'INBOUND'
      })
    ).rejects.toThrow(/purposeOfPayment/);
  });
});

describe('crossborder-travel-rule — audit', () => {
  it('writes a travel_rule.enforced audit event with hashed IDs', async () => {
    await crossborderTravelRuleService.enforce({
      envelope: validEnvelope(),
      direction: 'OUTBOUND'
    });
    const audit = await query(`SELECT event_type, payload FROM audit_events WHERE event_type = 'travel_rule.enforced'`);
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].payload.purposeOfPayment).toBe('REMITTANCE_FAMILY');
  });
});
