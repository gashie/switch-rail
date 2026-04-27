import * as db from '../../core/db.js';
import { createRecoveryModel } from './model.js';
import { createTransactionRecoveryService, PROBE_OUTCOMES } from './service.js';
import { createRecoveryWorker } from './worker.js';

// The FAILED + RECON_FAILED case writes a `transaction.reversal_needed`
// audit event from the recovery service. Phase 4 keeps the auto-reversal
// trigger conservative — an operator picks up the audit signal and runs
// the reversal manually. Phase 6 (fraud) will subscribe a real consumer.
const model = createRecoveryModel();
const service = createTransactionRecoveryService({ db, model });
const worker = createRecoveryWorker({ service });

export {
  createRecoveryModel,
  createTransactionRecoveryService,
  createRecoveryWorker,
  PROBE_OUTCOMES,
  service as transactionRecoveryService,
  worker as transactionRecoveryWorker
};
export { POLICIES, getPolicy, nextDelayMs, isExhausted, DEFAULT_POLICY_NAME } from './policy.js';
