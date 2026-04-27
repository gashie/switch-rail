import { describe, expect, it } from 'vitest';
import {
  RAIL_CODES,
  STATE_TO_ISO_STATUS,
  REASON_TO_ISO_REASON,
  CATEGORY,
  REASON_TO_CATEGORY,
  isoStatusFor,
  isoReasonFor,
  categoryFor
} from '../core/codes.js';

describe('core/codes — frozen tables', () => {
  it('RAIL_CODES is frozen', () => {
    expect(Object.isFrozen(RAIL_CODES)).toBe(true);
  });
  it('STATE_TO_ISO_STATUS is frozen', () => {
    expect(Object.isFrozen(STATE_TO_ISO_STATUS)).toBe(true);
  });
  it('REASON_TO_ISO_REASON is frozen', () => {
    expect(Object.isFrozen(REASON_TO_ISO_REASON)).toBe(true);
  });
  it('REASON_TO_CATEGORY is frozen', () => {
    expect(Object.isFrozen(REASON_TO_CATEGORY)).toBe(true);
  });
});

describe('core/codes — completeness', () => {
  it('every rail reason (except SUCCESS) has an ISO reason mapping', () => {
    const missing = Object.keys(RAIL_CODES)
      .filter((k) => k !== 'SUCCESS')
      .filter((k) => !(k in REASON_TO_ISO_REASON));
    expect(missing).toEqual([]);
  });

  it('every rail reason (except SUCCESS) has a category mapping', () => {
    const missing = Object.keys(RAIL_CODES)
      .filter((k) => k !== 'SUCCESS')
      .filter((k) => !(k in REASON_TO_CATEGORY));
    expect(missing).toEqual([]);
  });

  it('every transaction state has an ISO status mapping', () => {
    const requiredStates = [
      'RECEIVED',
      'AUTHORIZED',
      'ROUTED',
      'CREDIT_LEG_PENDING',
      'CONFIRMED',
      'PENDING_RECONCILIATION',
      'REJECTED',
      'FAILED',
      'REVERSED'
    ];
    for (const s of requiredStates) {
      expect(STATE_TO_ISO_STATUS[s]).toBeDefined();
    }
  });

  it('CATEGORY enum has the four canonical categories', () => {
    expect(Object.keys(CATEGORY).sort()).toEqual([
      'AMBIGUOUS',
      'RETRYABLE_FAIL',
      'TERMINAL_FAIL',
      'TERMINAL_SUCCESS'
    ]);
  });
});

describe('core/codes — locked mappings', () => {
  it('AC04 maps to BENEFICIARY_ACCOUNT_CLOSED in both directions', () => {
    expect(REASON_TO_ISO_REASON.BENEFICIARY_ACCOUNT_CLOSED).toBe('AC04');
  });
  it('AM04 maps to INSUFFICIENT_FUNDS', () => {
    expect(REASON_TO_ISO_REASON.INSUFFICIENT_FUNDS).toBe('AM04');
  });
  it('AM05 maps to DUPLICATE', () => {
    expect(REASON_TO_ISO_REASON.DUPLICATE).toBe('AM05');
  });
  it('CONFIRMED state maps to ACSC', () => {
    expect(STATE_TO_ISO_STATUS.CONFIRMED).toBe('ACSC');
  });
  it('REJECTED and FAILED both map to RJCT', () => {
    expect(STATE_TO_ISO_STATUS.REJECTED).toBe('RJCT');
    expect(STATE_TO_ISO_STATUS.FAILED).toBe('RJCT');
  });
  it('OPERATOR_KILL_SWITCH maps to RR04 (regulatory reason)', () => {
    expect(REASON_TO_ISO_REASON.OPERATOR_KILL_SWITCH).toBe('RR04');
  });
});

describe('core/codes — categorization', () => {
  it('TIMEOUT and UNREACHABLE are AMBIGUOUS (recovery decides)', () => {
    expect(REASON_TO_CATEGORY.TIMEOUT).toBe('AMBIGUOUS');
    expect(REASON_TO_CATEGORY.UNREACHABLE).toBe('AMBIGUOUS');
  });
  it('SETTLEMENT_FAILED is RETRYABLE_FAIL', () => {
    expect(REASON_TO_CATEGORY.SETTLEMENT_FAILED).toBe('RETRYABLE_FAIL');
  });
  it('Account-side rejections are TERMINAL_FAIL', () => {
    for (const k of [
      'BENEFICIARY_ACCOUNT_NOT_FOUND',
      'BENEFICIARY_ACCOUNT_CLOSED',
      'BENEFICIARY_ACCOUNT_BLOCKED',
      'INSUFFICIENT_FUNDS'
    ]) {
      expect(REASON_TO_CATEGORY[k]).toBe('TERMINAL_FAIL');
    }
  });
});

describe('core/codes — helpers', () => {
  it('isoStatusFor', () => {
    expect(isoStatusFor('CONFIRMED')).toBe('ACSC');
    expect(isoStatusFor('PENDING_RECONCILIATION')).toBe('PDNG');
    expect(isoStatusFor('UNKNOWN_STATE')).toBeUndefined();
  });
  it('isoReasonFor', () => {
    expect(isoReasonFor('INSUFFICIENT_FUNDS')).toBe('AM04');
    expect(isoReasonFor('UNKNOWN_REASON')).toBe('XT99');
  });
  it('categoryFor', () => {
    expect(categoryFor('TIMEOUT')).toBe('AMBIGUOUS');
    expect(categoryFor('UNKNOWN_REASON')).toBe('AMBIGUOUS');
  });
});
