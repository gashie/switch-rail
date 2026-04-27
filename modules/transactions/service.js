import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { STATES, isTerminal, canTransition } from './states.js';

const TIMESTAMP_FOR_STATE = Object.freeze({
  AUTHORIZED: 'authorized_at',
  ROUTED: 'routed_at',
  CREDIT_LEG_PENDING: 'credit_leg_started_at',
  CONFIRMED: 'confirmed_at',
  REJECTED: 'rejected_at',
  REVERSED: 'reversed_at',
  FAILED: 'failed_at'
});

// Default rail class on initial ingest. The orchestrator (B4.5/B4.7) will
// overwrite this once rail-class selection runs. It must satisfy the NOT NULL
// constraint on the column at insert time.
const DEFAULT_RAIL_CLASS = 'DOMESTIC_INSTANT';

export const createTransactionsService = ({ db, model }) => {
  const ingestOnClient = async (client, envelope) => {
    if (!envelope || typeof envelope !== 'object') {
      throw new AppError('VALIDATION_FAILED', 'envelope is required', 400);
    }
    const id = uuidv7();
    const inserted = await model.insertOnConflictReturn(client, {
      id,
      envelopeId: envelope.envelopeId,
      endToEndId: envelope.endToEndId,
      state: STATES.RECEIVED,
      railClass: DEFAULT_RAIL_CLASS,
      originatorParticipant: envelope.originator.participantCode,
      originatorAccount: envelope.originator.accountId,
      beneficiaryParticipant: envelope.beneficiary.participantCode,
      beneficiaryAccount: envelope.beneficiary.accountId,
      amountValue: envelope.amount.value,
      amountCurrency: envelope.amount.currency
    });
    if (inserted) {
      await model.insertHistory(client, {
        id: uuidv7(),
        transactionId: inserted.id,
        fromState: null,
        toState: STATES.RECEIVED,
        reasonCode: null,
        reasonMessage: null,
        payload: { envelopeId: envelope.envelopeId, sourceFormat: envelope.sourceFormat },
        occurredBy: 'system'
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'transaction.RECEIVED',
        resourceType: 'transaction',
        resourceId: inserted.id,
        payload: {
          envelopeId: envelope.envelopeId,
          originator: envelope.originator.participantCode,
          beneficiary: envelope.beneficiary.participantCode
        }
      });
      return inserted;
    }
    const existing = await model.findByEnvelopeId(client, envelope.envelopeId);
    if (!existing) {
      throw new AppError('INTERNAL', 'transaction conflict but row not found', 500);
    }
    return existing;
  };

  const transitionOnClient = async (
    client,
    transactionIdOrRow,
    toState,
    { reasonCode, reasonMessage, responseCode, occurredBy = 'system', payload = {} } = {}
  ) => {
    const tx =
      typeof transactionIdOrRow === 'string'
        ? await model.findById(client, transactionIdOrRow)
        : transactionIdOrRow;
    if (!tx) {
      throw new AppError('NOT_FOUND', 'transaction not found', 404);
    }
    if (!canTransition(tx.state, toState)) {
      throw new AppError(
        'CONFLICT',
        `transition ${tx.state} → ${toState} not allowed`,
        409,
        { from: tx.state, to: toState }
      );
    }
    const updated = await model.applyTransition(client, {
      id: tx.id,
      fromState: tx.state,
      toState,
      reasonCode,
      reasonMessage,
      responseCode,
      timestampColumn: TIMESTAMP_FOR_STATE[toState]
    });
    if (!updated) {
      throw new AppError(
        'CONFLICT',
        `concurrent transition: state changed under us`,
        409
      );
    }
    await model.insertHistory(client, {
      id: uuidv7(),
      transactionId: tx.id,
      fromState: tx.state,
      toState,
      reasonCode: reasonCode ?? null,
      reasonMessage: reasonMessage ?? null,
      payload,
      occurredBy
    });
    await auditService.record(client, {
      actorType: occurredBy.startsWith('operator:') ? 'user' : 'system',
      actorId: occurredBy.startsWith('operator:') ? occurredBy.slice(9) : null,
      eventType: `transaction.${toState}`,
      resourceType: 'transaction',
      resourceId: tx.id,
      payload: {
        from: tx.state,
        to: toState,
        reasonCode: reasonCode ?? null,
        ...payload
      }
    });
    return updated;
  };

  return {
    ingestFromEnvelope: (envOrClient, maybeEnv) => {
      if (envOrClient && typeof envOrClient.query === 'function') {
        return ingestOnClient(envOrClient, maybeEnv);
      }
      return db.withTransaction((c) => ingestOnClient(c, envOrClient));
    },

    transition: (clientOrId, idOrToState, toStateOrOpts, opts) => {
      // Two call shapes:
      //   transition(client, id, toState, opts)
      //   transition(id, toState, opts)
      if (clientOrId && typeof clientOrId.query === 'function') {
        return transitionOnClient(clientOrId, idOrToState, toStateOrOpts, opts);
      }
      return db.withTransaction((c) =>
        transitionOnClient(c, clientOrId, idOrToState, toStateOrOpts)
      );
    },

    findById: (id, client) =>
      client && typeof client.query === 'function'
        ? model.findById(client, id)
        : db.withClient((c) => model.findById(c, id)),

    findByEnvelopeId: (envelopeId, client) =>
      client && typeof client.query === 'function'
        ? model.findByEnvelopeId(client, envelopeId)
        : db.withClient((c) => model.findByEnvelopeId(c, envelopeId)),

    findByEndToEndId: (endToEndId) =>
      db.withClient((c) => model.findByEndToEndId(c, endToEndId)),

    listHistory: (transactionId) =>
      db.withClient((c) => model.listHistory(c, transactionId)),

    listForParticipant: (participantCode, opts) =>
      db.withClient((c) => model.listForParticipant(c, participantCode, opts)),

    listPendingReconciliationDue: (opts) =>
      db.withClient((c) => model.listPendingReconciliationDue(c, opts)),

    operatorKillSwitch: ({ id, reason, operatorId }) =>
      db.withTransaction(async (client) => {
        const tx = await model.findById(client, id);
        if (!tx) throw new AppError('NOT_FOUND', `transaction ${id} not found`, 404);
        if (isTerminal(tx.state)) {
          throw new AppError(
            'CONFLICT',
            `cannot kill transaction in terminal state ${tx.state}`,
            409
          );
        }
        return transitionOnClient(client, tx, STATES.REJECTED, {
          reasonCode: 'OPERATOR_KILL_SWITCH',
          reasonMessage: reason || 'operator action',
          responseCode: 'RJCT',
          occurredBy: operatorId ? `operator:${operatorId}` : 'operator:unknown',
          payload: { killSwitch: true, fromState: tx.state, reason: reason || null }
        });
      }),

    // Internal helpers used by the orchestrator and downstream modules.
    _internal: {
      insertReversal: (client, args) => model.insertReversal(client, args),
      setRailClass: (client, id, railClass) => model.setRailClass(client, id, railClass),
      countRecentByOriginatorAndE2E: (client, args) =>
        model.countRecentByOriginatorAndE2E(client, args),
      sumVolumeForOriginator: (client, args) => model.sumVolumeForOriginator(client, args),
      transitionOnClient: (client, txOrId, toState, opts) =>
        transitionOnClient(client, txOrId, toState, opts),
      ingestOnClient: (client, env) => ingestOnClient(client, env)
    }
  };
};
