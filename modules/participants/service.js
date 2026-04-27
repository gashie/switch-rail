import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { cryptoKeysService } from '../crypto-keys/index.js';

const toRow = (input) => ({
  code: input.code,
  name: input.name,
  legal_name: input.legalName,
  type: input.type,
  bic: input.bic,
  country_code: input.countryCode || 'GH',
  status: 'pending',
  supported_formats: input.supportedFormats || [],
  endpoints: input.endpoints || {},
  contact_email: input.contactEmail,
  contact_phone: input.contactPhone,
  metadata: input.metadata || {}
});

const camelKeys = (data) => {
  const map = {
    name: 'name',
    legalName: 'legal_name',
    bic: 'bic',
    countryCode: 'country_code',
    supportedFormats: 'supported_formats',
    endpoints: 'endpoints',
    contactEmail: 'contact_email',
    contactPhone: 'contact_phone',
    metadata: 'metadata'
  };
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (map[k]) {
      if (k === 'endpoints' || k === 'metadata') out[map[k]] = JSON.stringify(v);
      else out[map[k]] = v;
    }
  }
  return out;
};

const contentMatches = (existing, incoming) =>
  existing.name === incoming.name &&
  existing.legal_name === incoming.legal_name &&
  existing.type === incoming.type;

export const createParticipantsService = ({ db, model }) => ({
  create: (input) =>
    db.withTransaction(async (client) => {
      const incoming = toRow(input);
      const id = uuidv7();
      const inserted = await model.insertOnConflictReturn(client, { id, ...incoming });
      if (inserted) {
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'participant.created',
          resourceType: 'participant',
          resourceId: inserted.id,
          payload: { code: inserted.code, type: inserted.type, name: inserted.name }
        });
        return { participant: inserted, deduped: false };
      }
      const existing = await model.findByCode(client, incoming.code);
      if (!existing) {
        throw new AppError('INTERNAL', 'participant conflict but row not found', 500);
      }
      if (!contentMatches(existing, incoming)) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          `participant code ${incoming.code} already exists with different content`,
          409,
          { existingId: existing.id }
        );
      }
      return { participant: existing, deduped: true };
    }),

  update: (code, patch) =>
    db.withTransaction(async (client) => {
      const before = await model.findByCode(client, code);
      if (!before) throw new AppError('NOT_FOUND', `participant ${code} not found`, 404);
      const data = camelKeys(patch);
      const updated = await model.updateByCode(client, code, data);
      const changed = Object.keys(data);
      await auditService.record(client, {
        actorType: 'user',
        actorId: null,
        eventType: 'participant.updated',
        resourceType: 'participant',
        resourceId: updated.id,
        payload: { code, changedFields: changed }
      });
      return { participant: updated };
    }),

  list: ({ status, type, countryCode, limit, offset } = {}) =>
    db.withClient(async (client) => {
      const where = {};
      if (status) where.status = status;
      if (type) where.type = type;
      if (countryCode) where.country_code = countryCode;
      return model.findMany(client, { where, limit, offset });
    }),

  getByCode: (code) =>
    db.withClient(async (client) => {
      const row = await model.findByCode(client, code);
      if (!row) throw new AppError('NOT_FOUND', `participant ${code} not found`, 404);
      return row;
    }),

  listKeysFor: (code) =>
    db.withClient(async (client) => {
      const row = await model.findByCode(client, code);
      if (!row) throw new AppError('NOT_FOUND', `participant ${code} not found`, 404);
      return cryptoKeysService.listActive({ ownerType: 'participant', ownerId: code });
    }),

  // Internal-use status mutation, called by participant-onboarding during the
  // KYB → certifying → active workflow. Public PATCH /participants/:code does
  // NOT accept status — that goes through the onboarding state machine.
  setStatus: (code, { status, certifiedAt, activatedAt, suspendedAt }, client) => {
    const data = { status };
    if (certifiedAt !== undefined) data.certified_at = certifiedAt;
    if (activatedAt !== undefined) data.activated_at = activatedAt;
    if (suspendedAt !== undefined) data.suspended_at = suspendedAt;
    const run = async (c) => {
      const updated = await model.updateByCode(c, code, data);
      if (!updated) throw new AppError('NOT_FOUND', `participant ${code} not found`, 404);
      return updated;
    };
    return client && typeof client.query === 'function' ? run(client) : db.withTransaction(run);
  }
});
