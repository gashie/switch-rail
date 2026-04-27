import { AppError } from '../../core/errors.js';
import { transactionsService } from '../transactions/index.js';
import { auditService } from '../audit/index.js';
import { chooseClassFor, byName, REGISTRY } from './registry.js';

// `db` is intentionally not destructured: this service runs every operation
// inside a caller-supplied transaction client. Phase 5 (settlement) and
// Phase 9 (cross-border) will register their hooks via the registry rather
// than direct DB access from here.
export const createRailOrchestrationService = () => ({
  /**
   * Choose the rail class for a given transaction's parties + envelope,
   * persist it on transactions.rail_class, run prepare(), and write an
   * audit entry. Caller (the transaction orchestrator) supplies the
   * resolved participants so this service stays free of cross-module DB
   * reads.
   */
  orchestrate: async ({
    client,
    transactionId,
    envelope,
    originatorParticipant,
    beneficiaryParticipant
  }) => {
    if (!client || typeof client.query !== 'function') {
      throw new AppError('INTERNAL', 'orchestrate requires a transaction client', 500);
    }
    const cls = chooseClassFor({
      originator: originatorParticipant,
      beneficiary: beneficiaryParticipant,
      envelope
    });
    if (!cls) {
      throw new AppError(
        'CONFLICT',
        'no rail class matched for this transaction',
        409,
        {
          originator: originatorParticipant?.code,
          beneficiary: beneficiaryParticipant?.code
        }
      );
    }
    await transactionsService._internal.setRailClass(client, transactionId, cls.name);
    const prepared = await cls.prepare(client, { transactionId });
    await auditService.record(client, {
      actorType: 'system',
      eventType: 'transaction.rail_class.selected',
      resourceType: 'transaction',
      resourceId: transactionId,
      payload: {
        railClass: cls.name,
        priority: cls.priority,
        timeoutMs: cls.timeoutMs,
        retryPolicyName: cls.retryPolicyName
      }
    });
    return { railClass: cls, prepared };
  },

  byName,
  list: () => REGISTRY.map((c) => ({
    name: c.name,
    priority: c.priority,
    timeoutMs: c.timeoutMs,
    retryPolicyName: c.retryPolicyName
  })),

  // Pure helper — used by tests and (in B4.7) by the orchestrator before
  // opening the outer transaction so it can pre-allocate clients.
  pickClass: ({ originator, beneficiary, envelope }) =>
    chooseClassFor({ originator, beneficiary, envelope }) ||
    byName('DOMESTIC_INSTANT')
});
