import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query, withTransaction } from '../../../core/db.js';
import { createEnvelope, envelopeService } from '../../envelope/index.js';
import { participantsService } from '../../participants/index.js';
import { transactionsService } from '../../transactions/index.js';
import {
  REGISTRY,
  chooseClassFor,
  byName,
  railOrchestrationService
} from '../index.js';

const A = 'RCBANK_A';
const B = 'RCBANK_B';
const W = 'RCWALLET';
const F = 'RCFOREIGN';

const cleanup = async () => {
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'rc-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'participant.%'`);
  await query(`DELETE FROM participants WHERE code IN ($1,$2,$3,$4)`, [A, B, W, F]);
};

const seedParticipants = async () => {
  await participantsService.create({ code: A, name: 'Bank A', legalName: 'Bank A PLC', type: 'BANK', countryCode: 'GH' });
  await participantsService.create({ code: B, name: 'Bank B', legalName: 'Bank B PLC', type: 'BANK', countryCode: 'GH' });
  await participantsService.create({ code: W, name: 'Wallet', legalName: 'Wallet Ltd', type: 'WALLET', countryCode: 'GH' });
  await participantsService.create({ code: F, name: 'Foreign Rail', legalName: 'Foreign Rail Inc', type: 'FOREIGN_RAIL', countryCode: 'NG' });
};

beforeAll(async () => {
  await cleanup();
  await seedParticipants();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'rc-%'`);
});

describe('rail-orchestration — registry order', () => {
  it('REGISTRY is sorted by priority asc', () => {
    const priorities = REGISTRY.map((c) => c.priority);
    expect([...priorities].sort((x, y) => x - y)).toEqual(priorities);
  });

  it('byName resolves each registered class', () => {
    for (const cls of REGISTRY) {
      expect(byName(cls.name)?.name).toBe(cls.name);
    }
    expect(byName('NOT_REAL')).toBeNull();
  });
});

describe('rail-orchestration — classify priority order', () => {
  const ghBank = { code: 'X', country_code: 'GH', type: 'BANK' };
  const ghWallet = { code: 'X', country_code: 'GH', type: 'WALLET' };
  const ngBank = { code: 'X', country_code: 'NG', type: 'BANK' };

  it('GH bank → GH bank chooses DOMESTIC_INSTANT', () => {
    expect(chooseClassFor({ originator: ghBank, beneficiary: ghBank }).name).toBe('DOMESTIC_INSTANT');
  });

  it('GH bank → GH wallet still chooses DOMESTIC_INSTANT (priority 1 wins)', () => {
    expect(chooseClassFor({ originator: ghBank, beneficiary: ghWallet }).name).toBe(
      'DOMESTIC_INSTANT'
    );
  });

  it('different country codes choose FOREIGN', () => {
    expect(chooseClassFor({ originator: ghBank, beneficiary: ngBank }).name).toBe('FOREIGN');
  });

  it('opt-in batch envelope chooses DOMESTIC_BATCH only when batch=true', () => {
    expect(
      chooseClassFor({
        originator: ghBank,
        beneficiary: ghBank,
        envelope: { metadata: { batch: true } }
      }).name
    ).toBe('DOMESTIC_INSTANT'); // priority 1 still wins on classify
    // To trigger DOMESTIC_BATCH, none of the higher priorities can match:
    // contrive a case where originator/beneficiary are missing.
    expect(
      chooseClassFor({
        originator: null,
        beneficiary: null,
        envelope: { metadata: { batch: true } }
      })?.name
    ).toBe('DOMESTIC_BATCH');
  });

  it('returns null when nothing matches', () => {
    expect(chooseClassFor({ originator: null, beneficiary: null })).toBeNull();
  });
});

describe('rail-orchestration — service.orchestrate', () => {
  it('persists rail_class on the transaction and writes audit', async () => {
    const env = createEnvelope({
      msgType: 'CRDT_TRF',
      sourceFormat: 'REST',
      sourceMessageId: `rc-${Date.now()}`,
      endToEndId: `rc-e2e-${Date.now()}`,
      idempotencyKey: `rc-idem-${Date.now()}`,
      originator: { participantCode: A, accountId: '1', accountType: 'BANK_ACCOUNT', name: 'O' },
      beneficiary: { participantCode: B, accountId: '2', accountType: 'BANK_ACCOUNT', name: 'B' },
      amount: { value: '100', currency: 'GHS' }
    });
    await envelopeService.ingest(env);
    const tx = await transactionsService.ingestFromEnvelope(env);

    const result = await withTransaction(async (client) => {
      const partA = await participantsService.getByCode(A);
      const partB = await participantsService.getByCode(B);
      return railOrchestrationService.orchestrate({
        client,
        transactionId: tx.id,
        envelope: env,
        originatorParticipant: partA,
        beneficiaryParticipant: partB
      });
    });
    expect(result.railClass.name).toBe('DOMESTIC_INSTANT');
    const fresh = await transactionsService.findById(tx.id);
    expect(fresh.rail_class).toBe('DOMESTIC_INSTANT');
    const audit = await query(
      `SELECT count(*)::int AS n FROM audit_events WHERE event_type='transaction.rail_class.selected' AND resource_id=$1`,
      [tx.id]
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('chooses FOREIGN when participants are in different countries', async () => {
    const env = createEnvelope({
      msgType: 'CRDT_TRF',
      sourceFormat: 'REST',
      sourceMessageId: `rc-${Date.now()}-f`,
      endToEndId: `rc-e2e-${Date.now()}-f`,
      idempotencyKey: `rc-idem-${Date.now()}-f`,
      originator: { participantCode: A, accountId: '1', accountType: 'BANK_ACCOUNT', name: 'O' },
      beneficiary: { participantCode: F, accountId: '2', accountType: 'BANK_ACCOUNT', name: 'B' },
      amount: { value: '100', currency: 'GHS' }
    });
    await envelopeService.ingest(env);
    const tx = await transactionsService.ingestFromEnvelope(env);

    const result = await withTransaction(async (client) => {
      const partA = await participantsService.getByCode(A);
      const partF = await participantsService.getByCode(F);
      return railOrchestrationService.orchestrate({
        client,
        transactionId: tx.id,
        envelope: env,
        originatorParticipant: partA,
        beneficiaryParticipant: partF
      });
    });
    expect(result.railClass.name).toBe('FOREIGN');
  });
});
