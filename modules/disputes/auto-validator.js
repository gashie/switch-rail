import { SLA_WINDOWS } from './codes.js';
import { transactionsService } from '../transactions/index.js';

const ageInDays = (timestamp) => {
  if (!timestamp) return Infinity;
  const t = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  return Math.floor((Date.now() - t) / 86_400_000);
};

// Re-validates a FILED case before accepting. Returns
//   { ok: true, transaction } on success
//   { ok: false, reason, code } on failure (caller transitions to REJECTED).
// Filing-time validation already ran in service.file. This is a second
// gate before money moves into the reserve, so any drift between filing
// and processing (e.g. operator-killed source tx) is caught.
export const createAutoValidator = ({ model }) => {
  const validate = async (client, caseRow) => {
    if (!caseRow) return { ok: false, reason: 'CASE_MISSING', code: 'CASE_MISSING' };
    const sla = SLA_WINDOWS[caseRow.reason_code];
    if (!sla) {
      return { ok: false, reason: `unknown reason ${caseRow.reason_code}`, code: 'UNKNOWN_REASON' };
    }
    const tx = await transactionsService.findById(caseRow.transaction_id, client);
    if (!tx) return { ok: false, reason: 'tx_missing', code: 'TX_MISSING' };
    if (tx.state !== 'CONFIRMED' && tx.state !== 'REVERSED') {
      return {
        ok: false,
        reason: `tx in state ${tx.state}`,
        code: 'TX_BAD_STATE'
      };
    }
    if (sla.fileWithinDays !== null && ageInDays(tx.confirmed_at) > sla.fileWithinDays) {
      return { ok: false, reason: 'window_expired', code: 'WINDOW_EXPIRED' };
    }
    // Idempotency window: was an identical case (same tx + same reason) filed
    // and ALREADY ACCEPTED in the last 24h? If so, this filing is a dup.
    const dup = await model.findRecentDuplicateFiling(client, {
      transactionId: caseRow.transaction_id,
      reasonCode: caseRow.reason_code,
      filingParticipant: caseRow.filing_participant
    });
    if (dup && dup.id !== caseRow.id && (dup.state === 'ACCEPTED' || dup.state === 'EVIDENCE_PENDING' || dup.state === 'ADJUDICATING')) {
      return { ok: false, reason: 'idempotency_duplicate', code: 'IDEMPOTENCY_DUPLICATE' };
    }
    return { ok: true, transaction: tx };
  };

  return { validate };
};
