import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { createEnvelope, envelopeService } from '../../envelope/index.js';
import {
  transactionsService,
  STATES,
  TERMINAL_STATES,
  isTerminal,
  canTransition
} from '../index.js';

const baseEnvelope = (overrides = {}) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `tx-test-${Date.now()}-${Math.random()}`,
    endToEndId: `tx-e2e-${Date.now()}-${Math.random()}`,
    idempotencyKey: `tx-idem-${Date.now()}-${Math.random()}`,
    originator: {
      participantCode: 'TXBANK01',
      accountId: '0123000001',
      accountType: 'BANK_ACCOUNT',
      name: 'Originator'
    },
    beneficiary: {
      participantCode: 'TXBANK02',
      accountId: '0234000001',
      accountType: 'BANK_ACCOUNT',
      name: 'Beneficiary'
    },
    amount: { value: '15000', currency: 'GHS' },
    ...overrides
  });

const cleanup = async () => {
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'tx-test-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%'`);
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

const ingestEnv = async (env) => {
  await envelopeService.ingest(env);
  return transactionsService.ingestFromEnvelope(env);
};

describe('transactions — state machine constants', () => {
  it('TERMINAL_STATES are exactly the four locked terminals', () => {
    expect([...TERMINAL_STATES].sort()).toEqual(['CONFIRMED', 'FAILED', 'REJECTED', 'REVERSED']);
  });

  it('isTerminal flags terminal states', () => {
    expect(isTerminal('CONFIRMED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(true);
    expect(isTerminal('RECEIVED')).toBe(false);
    expect(isTerminal('CREDIT_LEG_PENDING')).toBe(false);
  });

  it('canTransition allows the locked edges and rejects others', () => {
    expect(canTransition('RECEIVED', 'AUTHORIZED')).toBe(true);
    expect(canTransition('AUTHORIZED', 'ROUTED')).toBe(true);
    expect(canTransition('ROUTED', 'CREDIT_LEG_PENDING')).toBe(true);
    expect(canTransition('CREDIT_LEG_PENDING', 'CONFIRMED')).toBe(true);
    expect(canTransition('CREDIT_LEG_PENDING', 'PENDING_RECONCILIATION')).toBe(true);
    expect(canTransition('PENDING_RECONCILIATION', 'FAILED')).toBe(true);
    expect(canTransition('CONFIRMED', 'REVERSED')).toBe(true);
    // Forbidden edges:
    expect(canTransition('RECEIVED', 'CONFIRMED')).toBe(false);
    expect(canTransition('CONFIRMED', 'AUTHORIZED')).toBe(false);
    expect(canTransition('REJECTED', 'CONFIRMED')).toBe(false);
    expect(canTransition('REVERSED', 'CONFIRMED')).toBe(false);
  });

  it('operator kill-switch: REJECTED is reachable from any non-terminal state', () => {
    for (const s of [
      'RECEIVED',
      'AUTHORIZED',
      'ROUTED',
      'CREDIT_LEG_PENDING',
      'PENDING_RECONCILIATION'
    ]) {
      expect(canTransition(s, 'REJECTED')).toBe(true);
    }
    // And NOT from terminal states.
    for (const s of TERMINAL_STATES) {
      expect(canTransition(s, 'REJECTED')).toBe(false);
    }
  });
});

describe('transactions — ingest', () => {
  it('creates a RECEIVED transaction with initial history', async () => {
    const env = baseEnvelope();
    const tx = await ingestEnv(env);
    expect(tx.state).toBe(STATES.RECEIVED);
    expect(tx.envelope_id).toBe(env.envelopeId);
    expect(tx.end_to_end_id).toBe(env.endToEndId);
    const history = await transactionsService.listHistory(tx.id);
    expect(history).toHaveLength(1);
    expect(history[0].to_state).toBe('RECEIVED');
    expect(history[0].from_state).toBeNull();
  });

  it('idempotently returns the same transaction for the same envelope', async () => {
    const env = baseEnvelope();
    const a = await ingestEnv(env);
    const b = await transactionsService.ingestFromEnvelope(env);
    expect(b.id).toBe(a.id);
    const history = await transactionsService.listHistory(a.id);
    // The second call must NOT add a new RECEIVED row.
    expect(history.filter((h) => h.to_state === 'RECEIVED')).toHaveLength(1);
  });
});

describe('transactions — transition', () => {
  it('walks the locked happy path and writes a history row per transition', async () => {
    const env = baseEnvelope();
    const tx = await ingestEnv(env);
    let cur = await transactionsService.transition(tx.id, 'AUTHORIZED');
    expect(cur.state).toBe('AUTHORIZED');
    expect(cur.authorized_at).not.toBeNull();
    cur = await transactionsService.transition(cur.id, 'ROUTED');
    expect(cur.state).toBe('ROUTED');
    expect(cur.routed_at).not.toBeNull();
    cur = await transactionsService.transition(cur.id, 'CREDIT_LEG_PENDING');
    expect(cur.state).toBe('CREDIT_LEG_PENDING');
    expect(cur.credit_leg_started_at).not.toBeNull();
    cur = await transactionsService.transition(cur.id, 'CONFIRMED', {
      responseCode: 'ACSC'
    });
    expect(cur.state).toBe('CONFIRMED');
    expect(cur.response_code).toBe('ACSC');
    const history = await transactionsService.listHistory(tx.id);
    expect(history.map((h) => h.to_state)).toEqual([
      'RECEIVED',
      'AUTHORIZED',
      'ROUTED',
      'CREDIT_LEG_PENDING',
      'CONFIRMED'
    ]);
  });

  it('rejects an invalid transition with CONFLICT', async () => {
    const env = baseEnvelope();
    const tx = await ingestEnv(env);
    await expect(
      transactionsService.transition(tx.id, 'CONFIRMED')
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('forbids any transition out of a terminal state (CONFIRMED → AUTHORIZED, etc.)', async () => {
    const env = baseEnvelope();
    const tx = await ingestEnv(env);
    await transactionsService.transition(tx.id, 'AUTHORIZED');
    await transactionsService.transition(tx.id, 'ROUTED');
    await transactionsService.transition(tx.id, 'CREDIT_LEG_PENDING');
    await transactionsService.transition(tx.id, 'CONFIRMED', { responseCode: 'ACSC' });
    await expect(
      transactionsService.transition(tx.id, 'AUTHORIZED')
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      transactionsService.transition(tx.id, 'REJECTED')
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    // CONFIRMED → REVERSED is the one allowed forward edge.
    const reversed = await transactionsService.transition(tx.id, 'REVERSED');
    expect(reversed.state).toBe('REVERSED');
  });
});

describe('transactions — operator kill-switch', () => {
  it('rejects from each non-terminal state', async () => {
    for (const targetState of ['RECEIVED', 'AUTHORIZED', 'ROUTED', 'CREDIT_LEG_PENDING', 'PENDING_RECONCILIATION']) {
      const env = baseEnvelope();
      const tx = await ingestEnv(env);
      // Walk to the target state.
      const path = ['AUTHORIZED', 'ROUTED', 'CREDIT_LEG_PENDING', 'PENDING_RECONCILIATION'];
      for (const s of path) {
        if (s === targetState) break;
        await transactionsService.transition(tx.id, s);
      }
      if (targetState !== 'RECEIVED') {
        await transactionsService.transition(tx.id, targetState);
      }
      const killed = await transactionsService.operatorKillSwitch({
        id: tx.id,
        reason: 'manual test',
        operatorId: 'admin-uuid'
      });
      expect(killed.state).toBe('REJECTED');
      expect(killed.reason_code).toBe('OPERATOR_KILL_SWITCH');
      expect(killed.rejected_at).not.toBeNull();
    }
  });

  it('refuses to kill a transaction already in a terminal state', async () => {
    const env = baseEnvelope();
    const tx = await ingestEnv(env);
    await transactionsService.transition(tx.id, 'AUTHORIZED');
    await transactionsService.transition(tx.id, 'REJECTED', { reasonCode: 'AG01' });
    await expect(
      transactionsService.operatorKillSwitch({ id: tx.id, reason: 'too late' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('transactions — query', () => {
  it('listForParticipant returns transactions where participant is originator OR beneficiary', async () => {
    const env = baseEnvelope();
    await ingestEnv(env);
    const orig = await transactionsService.listForParticipant('TXBANK01', { limit: 10, offset: 0 });
    const bene = await transactionsService.listForParticipant('TXBANK02', { limit: 10, offset: 0 });
    expect(orig.total).toBeGreaterThan(0);
    expect(bene.total).toBeGreaterThan(0);
  });
});
