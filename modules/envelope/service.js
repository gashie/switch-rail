import { AppError } from '../../core/errors.js';
import { auditService } from '../audit/index.js';
import { assertEnvelope } from './validators.js';

const contentMatches = (a, b) =>
  a.amount.value === b.amount.value &&
  a.amount.currency === b.amount.currency &&
  a.originator.participantCode === b.originator.participantCode &&
  a.originator.accountId === b.originator.accountId &&
  a.beneficiary.participantCode === b.beneficiary.participantCode &&
  a.beneficiary.accountId === b.beneficiary.accountId;

export const createEnvelopeService = ({ db, model }) => {
  const ingestOnClient = async (client, env) => {
    const validated = assertEnvelope(env);

    const insertResult = await model.insertIfAbsent(client, validated);
    if (insertResult.inserted) {
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'envelope.ingested',
        resourceType: 'envelope',
        resourceId: validated.envelopeId,
        payload: {
          sourceFormat: validated.sourceFormat,
          msgType: validated.msgType,
          originatorParticipant: validated.originator.participantCode,
          beneficiaryParticipant: validated.beneficiary.participantCode
        }
      });
      return { envelope: insertResult.row, deduped: false };
    }

    const existing = await model.findByIdempotencyKey(
      client,
      validated.originator.participantCode,
      validated.idempotencyKey
    );
    if (!existing) {
      throw new AppError('INTERNAL', 'idempotency conflict but row not found', 500);
    }

    if (contentMatches(existing, validated)) {
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'envelope.deduped',
        resourceType: 'envelope',
        resourceId: existing.envelopeId,
        payload: {
          idempotencyKey: validated.idempotencyKey,
          originatorParticipant: validated.originator.participantCode
        }
      });
      return { envelope: existing, deduped: true };
    }

    throw new AppError(
      'IDEMPOTENCY_CONFLICT',
      'idempotencyKey already used with different content',
      409,
      {
        existingEnvelopeId: existing.envelopeId,
        idempotencyKey: validated.idempotencyKey
      }
    );
  };

  return {
    ingest: (envOrFirst, maybeClient) => {
      // Two call shapes:
      //   ingest(env)             — service opens its own transaction
      //   ingest(env, client)     — caller owns the transaction
      if (maybeClient && typeof maybeClient.query === 'function') {
        return ingestOnClient(maybeClient, envOrFirst);
      }
      return db.withTransaction((c) => ingestOnClient(c, envOrFirst));
    },

    findByEnvelopeId: (envelopeId) =>
      db.withClient((c) => model.findByEnvelopeId(c, envelopeId)),

    findByIdempotencyKey: (participantCode, idempotencyKey) =>
      db.withClient((c) =>
        model.findByIdempotencyKey(c, participantCode, idempotencyKey)
      ),

    list: (input) => db.withClient((c) => model.list(c, input))
  };
};
