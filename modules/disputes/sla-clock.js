import { SLA_WINDOWS } from './codes.js';

// Given a reason code, compute the deadline for evidence response from now.
// Calendar-day arithmetic — Phase 7 doesn't model business hours.
export const evidencePendingUntil = (reasonCode, fromDate = new Date()) => {
  const sla = SLA_WINDOWS[reasonCode];
  if (!sla) {
    throw new Error(`unknown reason code ${reasonCode}`);
  }
  const ms = fromDate.getTime() + sla.responseDays * 86_400_000;
  return new Date(ms);
};

// Convenience: returns true if the case's evidence_pending_until has elapsed.
export const isEvidenceWindowExpired = (caseRow, now = new Date()) => {
  if (!caseRow?.evidence_pending_until) return false;
  const deadline = caseRow.evidence_pending_until instanceof Date
    ? caseRow.evidence_pending_until
    : new Date(caseRow.evidence_pending_until);
  return now.getTime() >= deadline.getTime();
};
