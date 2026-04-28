import { describe, expect, it } from 'vitest';
import { toneFor, labelFor, allKnownStates, STATUS_TONES } from './status-map.js';

describe('status-map', () => {
  it('toneFor returns success palette for CONFIRMED', () => {
    const t = toneFor('CONFIRMED');
    expect(t.bg).toBe('bg-emerald-50');
    expect(t.fg).toBe('text-emerald-700');
  });

  it('toneFor returns fail palette for REJECTED', () => {
    expect(toneFor('REJECTED').bg).toBe('bg-red-50');
  });

  it('toneFor returns review palette for PENDING_RECONCILIATION', () => {
    expect(toneFor('PENDING_RECONCILIATION').bg).toBe('bg-amber-100');
  });

  it('toneFor falls back to neutral for unknown state', () => {
    expect(toneFor('NOT_A_REAL_STATE').bg).toBe('bg-graphite-100');
  });

  it('toneFor handles null/undefined', () => {
    expect(toneFor(null).bg).toBe('bg-graphite-100');
    expect(toneFor(undefined).bg).toBe('bg-graphite-100');
  });

  it('labelFor returns human label for known state', () => {
    expect(labelFor('CONFIRMED')).toBe('Confirmed');
    expect(labelFor('CREDIT_LEG_PENDING')).toBe('Credit leg pending');
  });

  it('labelFor returns the raw code for unknown state', () => {
    expect(labelFor('SURPRISE')).toBe('SURPRISE');
  });

  it('allKnownStates includes core lifecycle states', () => {
    const all = allKnownStates();
    for (const s of ['CONFIRMED', 'REJECTED', 'AUTHORIZED', 'SETTLED', 'FROZEN']) {
      expect(all).toContain(s);
    }
  });

  it('STATUS_TONES is frozen', () => {
    expect(Object.isFrozen(STATUS_TONES)).toBe(true);
  });
});
