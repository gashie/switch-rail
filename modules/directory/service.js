import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { participantsService } from '../participants/index.js';

export const normalizeName = (name) =>
  String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

// existing is the DB row (snake_case); incoming is the camelCase input.
const contentMatches = (existing, incoming) =>
  existing.account_type === incoming.accountType &&
  existing.account_name_normalized === incoming.accountNameNormalized &&
  existing.currency === incoming.currency;

export const createDirectoryService = ({ db, model }) => ({
  register: ({ participantCode, accountType, accountNumber, accountName, currency, metadata }) =>
    db.withTransaction(async (client) => {
      const participant = await participantsService.getByCode(participantCode);
      if (participant.status !== 'active') {
        throw new AppError(
          'CONFLICT',
          `participant ${participantCode} is not active (status=${participant.status})`,
          409
        );
      }
      const accountNameNormalized = normalizeName(accountName);
      const id = uuidv7();
      const incoming = {
        id,
        participantId: participant.id,
        participantCode,
        accountType,
        accountNumber,
        accountName,
        accountNameNormalized,
        currency: currency || 'GHS',
        metadata: metadata || {}
      };
      const inserted = await model.insertOnConflictReturn(client, incoming);
      if (inserted) {
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'directory.account.registered',
          resourceType: 'account',
          resourceId: inserted.id,
          payload: {
            participantCode,
            accountNumber,
            accountType
          }
        });
        return { account: inserted, deduped: false };
      }
      const existing = await model.findByAccount(client, { participantCode, accountNumber });
      if (!existing) {
        throw new AppError('INTERNAL', 'account conflict but row not found', 500);
      }
      if (!contentMatches(existing, incoming)) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          `account ${participantCode}/${accountNumber} already exists with different content`,
          409
        );
      }
      return { account: existing, deduped: true };
    }),

  findByAccount: ({ participantCode, accountNumber }) =>
    db.withClient(async (client) => {
      const row = await model.findByAccount(client, { participantCode, accountNumber });
      if (!row) {
        throw new AppError(
          'NOT_FOUND',
          `account ${participantCode}/${accountNumber} not found`,
          404
        );
      }
      return row;
    }),

  // Lookup by surrogate id; used cross-module (aliases, name-enquiry). Returns
  // null if not found rather than throwing — callers decide whether missing
  // is a hard error or a tolerated case.
  findById: (id, client) => {
    const run = (c) => model.findById(c, id);
    return client && typeof client.query === 'function' ? run(client) : db.withClient(run);
  },

  list: (input) => db.withClient((client) => model.list(client, input)),

  searchByName: ({ participantCode, q, limit = 10 }) =>
    db.withClient((client) =>
      model.searchByName(client, {
        participantCode,
        pattern: normalizeName(q),
        limit
      })
    ),

  freeze: ({ participantCode, accountNumber }) =>
    db.withTransaction(async (client) => {
      const row = await model.findByAccount(client, { participantCode, accountNumber });
      if (!row) {
        throw new AppError(
          'NOT_FOUND',
          `account ${participantCode}/${accountNumber} not found`,
          404
        );
      }
      if (row.status !== 'active') {
        throw new AppError('CONFLICT', `cannot freeze account in state ${row.status}`, 409);
      }
      const updated = await model.setStatus(client, {
        participantCode,
        accountNumber,
        status: 'frozen'
      });
      await auditService.record(client, {
        actorType: 'user',
        eventType: 'directory.account.frozen',
        resourceType: 'account',
        resourceId: updated.id,
        payload: { participantCode, accountNumber }
      });
      return { account: updated };
    }),

  unfreeze: ({ participantCode, accountNumber }) =>
    db.withTransaction(async (client) => {
      const row = await model.findByAccount(client, { participantCode, accountNumber });
      if (!row) {
        throw new AppError(
          'NOT_FOUND',
          `account ${participantCode}/${accountNumber} not found`,
          404
        );
      }
      if (row.status !== 'frozen') {
        throw new AppError('CONFLICT', `cannot unfreeze account in state ${row.status}`, 409);
      }
      const updated = await model.setStatus(client, {
        participantCode,
        accountNumber,
        status: 'active'
      });
      await auditService.record(client, {
        actorType: 'user',
        eventType: 'directory.account.unfrozen',
        resourceType: 'account',
        resourceId: updated.id,
        payload: { participantCode, accountNumber }
      });
      return { account: updated };
    }),

  close: ({ participantCode, accountNumber }) =>
    db.withTransaction(async (client) => {
      const row = await model.findByAccount(client, { participantCode, accountNumber });
      if (!row) {
        throw new AppError(
          'NOT_FOUND',
          `account ${participantCode}/${accountNumber} not found`,
          404
        );
      }
      if (row.status === 'closed') {
        return { account: row };
      }
      const updated = await model.setStatus(client, {
        participantCode,
        accountNumber,
        status: 'closed',
        closedAt: new Date()
      });
      await auditService.record(client, {
        actorType: 'user',
        eventType: 'directory.account.closed',
        resourceType: 'account',
        resourceId: updated.id,
        payload: { participantCode, accountNumber }
      });
      return { account: updated };
    })
});
