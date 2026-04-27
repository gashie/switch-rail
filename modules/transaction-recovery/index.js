import * as db from '../../core/db.js';
import { createRecoveryModel } from './model.js';
import { createTransactionRecoveryService, PROBE_OUTCOMES } from './service.js';
import { createRecoveryWorker } from './worker.js';

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
