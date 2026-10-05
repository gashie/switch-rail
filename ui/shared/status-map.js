// Locked status badge → label/color mapping. Every page imports from here.
// New states must be added here, never hardcoded inside a page.

const SUCCESS = 'success';
const PROGRESS = 'progress';
const REVIEW = 'review';
const FAIL = 'fail';
const REVERSED = 'reversed';
const AUTO_RESOLVED = 'auto_resolved';
const UPHELD = 'upheld';
const SUSPENDED = 'suspended';
const ONBOARDING = 'onboarding';
const NEUTRAL = 'neutral';

export const STATUS_TONES = Object.freeze({
  [SUCCESS]:        { label: null, bg: 'bg-emerald-50',  fg: 'text-emerald-700',  border: 'border-emerald-200' },
  [PROGRESS]:       { label: 'In progress',  bg: 'bg-amber-50',  fg: 'text-amber-600',  border: 'border-amber-200' },
  [REVIEW]:         { label: 'Needs review', bg: 'bg-amber-100', fg: 'text-amber-700',  border: 'border-amber-200' },
  [FAIL]:           { label: null, bg: 'bg-red-50',     fg: 'text-red-600',    border: 'border-red-200' },
  [REVERSED]:       { label: 'Reversed', bg: 'bg-graphite-100', fg: 'text-graphite-700', border: 'border-graphite-300' },
  [AUTO_RESOLVED]:  { label: 'Auto-resolved', bg: 'bg-emerald-100', fg: 'text-emerald-700', border: 'border-emerald-200' },
  [UPHELD]:         { label: null, bg: 'bg-emerald-50', fg: 'text-emerald-700', border: 'border-emerald-200' },
  [SUSPENDED]:      { label: null, bg: 'bg-red-100', fg: 'text-red-700', border: 'border-red-200' },
  [ONBOARDING]:     { label: 'Onboarding', bg: 'bg-blue-50', fg: 'text-blue-600', border: 'border-blue-200' },
  [NEUTRAL]:        { label: null, bg: 'bg-graphite-100', fg: 'text-graphite-700', border: 'border-graphite-300' }
});

// Backend → tone. Keep this list authoritative; add new states here when
// the backend introduces them.
const TONE_BY_STATE = Object.freeze({
  CONFIRMED: SUCCESS, ACSC: SUCCESS, ACTIVE: SUCCESS, SETTLED: SUCCESS,
  RESOLVED: SUCCESS, MATCH: SUCCESS, PASS: SUCCESS, COMPLETED: SUCCESS,
  PAID: SUCCESS, HELD: SUCCESS, RELEASED: SUCCESS,
  RECEIVED: PROGRESS, AUTHORIZED: PROGRESS, ROUTED: PROGRESS,
  CREDIT_LEG_PENDING: PROGRESS, EVIDENCE_PENDING: PROGRESS, ADJUDICATING: PROGRESS,
  INITIATED: PROGRESS, OPEN: PROGRESS, PENDING: PROGRESS, RUNNING: PROGRESS,
  QUEUED: PROGRESS, FILED: PROGRESS, ACCEPTED: PROGRESS, FOREIGN_INSTRUCTING: PROGRESS,
  PENDING_FOREIGN: PROGRESS, PROCESSING: PROGRESS, FROZEN: PROGRESS,
  PENDING_RECONCILIATION: REVIEW, PARTIAL: REVIEW, REVIEW: REVIEW,
  REJECTED: FAIL, DENIED: FAIL, FAILED: FAIL, BLOCK: FAIL,
  EXPIRED: FAIL, CLOSED: FAIL, REVOKED: FAIL, NO_MATCH: FAIL, CANCELLED: FAIL,
  EXHAUSTED: FAIL, CONSUMED: SUCCESS, REJECTED_SLIPPAGE: FAIL,
  REVERSED: REVERSED,
  AUTO_RESOLVED: AUTO_RESOLVED,
  UPHELD: UPHELD, PARTIAL_UPHELD: UPHELD,
  SUSPENDED: SUSPENDED, TERMINATED: SUSPENDED, KILLED: SUSPENDED,
  KYB: ONBOARDING, CERTIFYING: ONBOARDING
});

const HUMAN_LABEL_BY_STATE = Object.freeze({
  CONFIRMED: 'Confirmed', ACSC: 'Confirmed', ACTIVE: 'Active', SETTLED: 'Settled',
  RESOLVED: 'Resolved', MATCH: 'Match', PASS: 'Pass', COMPLETED: 'Completed',
  PAID: 'Paid', HELD: 'Held', RELEASED: 'Released',
  RECEIVED: 'Received', AUTHORIZED: 'Authorized', ROUTED: 'Routed',
  CREDIT_LEG_PENDING: 'Credit leg pending', EVIDENCE_PENDING: 'Evidence pending',
  ADJUDICATING: 'Adjudicating', INITIATED: 'Initiated', OPEN: 'Open',
  PENDING: 'Pending', RUNNING: 'Running', QUEUED: 'Queued', FILED: 'Filed',
  ACCEPTED: 'Accepted', FOREIGN_INSTRUCTING: 'Instructing foreign rail',
  PENDING_FOREIGN: 'Awaiting foreign rail', PROCESSING: 'Processing',
  FROZEN: 'Frozen',
  PENDING_RECONCILIATION: 'Pending reconciliation', PARTIAL: 'Partial', REVIEW: 'Review',
  REJECTED: 'Rejected', DENIED: 'Denied', FAILED: 'Failed', BLOCK: 'Blocked',
  EXPIRED: 'Expired', CLOSED: 'Closed', REVOKED: 'Revoked', NO_MATCH: 'No match',
  CANCELLED: 'Cancelled', EXHAUSTED: 'Exhausted', CONSUMED: 'Consumed',
  REJECTED_SLIPPAGE: 'Rejected (slippage)',
  REVERSED: 'Reversed', AUTO_RESOLVED: 'Auto-resolved',
  UPHELD: 'Upheld', PARTIAL_UPHELD: 'Partial uphold',
  SUSPENDED: 'Suspended', TERMINATED: 'Terminated', KILLED: 'Killed',
  KYB: 'KYB', CERTIFYING: 'Certifying'
});

export const toneFor = (state) => {
  if (!state) return STATUS_TONES[NEUTRAL];
  const tone = TONE_BY_STATE[state] || NEUTRAL;
  return STATUS_TONES[tone];
};

export const labelFor = (state) => {
  if (!state) return '';
  return HUMAN_LABEL_BY_STATE[state] || state;
};

export const allKnownStates = () => Object.keys(TONE_BY_STATE);
