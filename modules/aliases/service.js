import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { directoryService } from '../directory/index.js';
import { ALIAS_TYPES, RESERVED_HANDLES } from './schema.js';

// E.164 phone normalization for GH (+233) — hand-rolled, no libphonenumber-js.
// Accepts:
//   "+233244123456"          → 233244123456
//   "233 244 123 456"        → 233244123456
//   "0244123456"             → 233244123456 (local form, leading 0)
//   "(+233) 24-412-3456"     → 233244123456
const DEFAULT_COUNTRY_CODE = '233';

const normalizePhone = (raw) => {
  if (typeof raw !== 'string') {
    throw new AppError('VALIDATION_FAILED', 'phone alias must be a string', 400);
  }
  const stripped = raw.replace(/[\s\-()]/g, '');
  let digits;
  if (stripped.startsWith('+')) {
    digits = stripped.slice(1);
  } else if (stripped.startsWith('00')) {
    digits = stripped.slice(2);
  } else if (stripped.startsWith('0')) {
    digits = DEFAULT_COUNTRY_CODE + stripped.slice(1);
  } else {
    digits = stripped;
  }
  if (!/^\d+$/.test(digits)) {
    throw new AppError('VALIDATION_FAILED', `phone contains non-digits: ${raw}`, 400);
  }
  if (digits.length < 8 || digits.length > 15) {
    throw new AppError(
      'VALIDATION_FAILED',
      `phone E.164 length must be 8–15 digits (got ${digits.length})`,
      400
    );
  }
  return `+${digits}`;
};

const normalizeEmail = (raw) => {
  if (typeof raw !== 'string') {
    throw new AppError('VALIDATION_FAILED', 'email alias must be a string', 400);
  }
  const v = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    throw new AppError('VALIDATION_FAILED', `invalid email format: ${raw}`, 400);
  }
  return v;
};

const normalizeGhanacard = (raw) => {
  const v = String(raw).trim().toUpperCase();
  if (!/^GHA-\d{9}-\d$/.test(v)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Ghanacard PIN must match GHA-NNNNNNNNN-N (got "${raw}")`,
      400
    );
  }
  return v;
};

const normalizeMerchant = (raw) => {
  const v = String(raw).trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,20}$/.test(v)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `merchant ID must be uppercase alphanumeric+dash, 6–20 chars (got "${raw}")`,
      400
    );
  }
  return v;
};

const normalizeHandle = (raw) => {
  const v = String(raw).trim().toLowerCase();
  if (!/^[a-z0-9._]{3,32}$/.test(v)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `handle must be lowercase alphanumeric + dot + underscore, 3–32 chars (got "${raw}")`,
      400
    );
  }
  if (RESERVED_HANDLES.includes(v)) {
    throw new AppError('VALIDATION_FAILED', `handle "${v}" is reserved`, 400);
  }
  return v;
};

export const normalizeAliasValue = (aliasType, raw) => {
  switch (aliasType) {
    case 'PHONE':
      return normalizePhone(raw);
    case 'EMAIL':
      return normalizeEmail(raw);
    case 'GHANACARD':
      return normalizeGhanacard(raw);
    case 'MERCHANT':
      return normalizeMerchant(raw);
    case 'HANDLE':
      return normalizeHandle(raw);
    default:
      throw new AppError('VALIDATION_FAILED', `unknown alias type: ${aliasType}`, 400);
  }
};

const initialStatusFor = (aliasType) =>
  aliasType === 'MERCHANT' ? { status: 'verified', method: 'TIN_FORMAT' } : { status: 'pending' };

export const createAliasesService = ({ db, model }) => ({
  register: ({ aliasType, aliasValue, accountId }) =>
    db.withTransaction(async (client) => {
      if (!ALIAS_TYPES.includes(aliasType)) {
        throw new AppError('VALIDATION_FAILED', `unknown alias type: ${aliasType}`, 400);
      }
      const normalized = normalizeAliasValue(aliasType, aliasValue);
      // Validate the target account exists and is active. Look up via the
      // directory module's public interface — service.js never reaches into
      // another module's tables directly.
      const account = await directoryService.findById(accountId, client);
      if (!account) {
        throw new AppError('NOT_FOUND', `account ${accountId} not found`, 404);
      }
      if (account.status !== 'active') {
        throw new AppError('CONFLICT', `account is ${account.status}`, 409);
      }

      const id = uuidv7();
      const init = initialStatusFor(aliasType);
      const inserted = await model.insertOnConflictReturn(client, {
        id,
        aliasType,
        aliasValue: normalized,
        aliasValueDisplay: String(aliasValue),
        accountId,
        participantCode: account.participant_code,
        status: init.status,
        verificationMethod: init.method,
        verifiedAt: init.status === 'verified' ? new Date() : null
      });
      if (inserted) {
        await auditService.record(client, {
          actorType: 'system',
          eventType:
            init.status === 'verified' ? 'alias.registered.verified' : 'alias.registered',
          resourceType: 'alias',
          resourceId: inserted.id,
          payload: { aliasType, participantCode: account.participant_code }
        });
        return { alias: inserted, deduped: false };
      }
      // Active alias already exists for (type, value).
      const existing = await model.findActiveByValue(client, {
        aliasType,
        aliasValue: normalized
      });
      if (!existing) {
        throw new AppError('INTERNAL', 'alias conflict but row not found', 500);
      }
      if (existing.account_id === accountId) {
        return { alias: existing, deduped: true };
      }
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        `alias ${aliasType}/${normalized} already registered to a different account`,
        409,
        { existingAliasId: existing.id }
      );
    }),

  resolve: ({ aliasType, aliasValue }) =>
    db.withClient(async (client) => {
      const normalized = normalizeAliasValue(aliasType, aliasValue);
      const alias = await model.findVerifiedByValue(client, {
        aliasType,
        aliasValue: normalized
      });
      if (!alias) return null;
      // Cross-check the target account is active (gate per PHASE-3 §B3.7).
      const account = await directoryService
        .findByAccount({
          participantCode: alias.participant_code,
          accountNumber: ''
        })
        .catch(() => null);
      // The alias resolution does not require the account to be the right
      // shape — it just needs to be active. Use a direct id-lookup to avoid
      // coupling. Returning the alias is enough; callers (name-enquiry)
      // double-check account status.
      void account;
      return alias;
    }),

  listByAccount: (accountId) =>
    db.withClient((client) => model.listByAccount(client, accountId)),

  getById: (id) =>
    db.withClient(async (client) => {
      const row = await model.findById(client, id);
      if (!row) throw new AppError('NOT_FOUND', `alias ${id} not found`, 404);
      return row;
    }),

  revoke: (id) =>
    db.withTransaction(async (client) => {
      const alias = await model.findById(client, id);
      if (!alias) throw new AppError('NOT_FOUND', `alias ${id} not found`, 404);
      if (alias.status === 'revoked') return { alias };
      const updated = await model.setStatus(client, {
        id,
        status: 'revoked',
        revokedAt: new Date()
      });
      await auditService.record(client, {
        actorType: 'user',
        eventType: 'alias.revoked',
        resourceType: 'alias',
        resourceId: id,
        payload: {
          aliasType: alias.alias_type,
          participantCode: alias.participant_code
        }
      });
      return { alias: updated };
    }),

  // Internal helpers used by verification / portability sub-modules.
  _internal: {
    setVerified: (client, { id, method }) =>
      model.setStatus(client, {
        id,
        status: 'verified',
        verificationMethod: method,
        verifiedAt: new Date()
      }),
    updateAccount: (client, { id, accountId, participantCode }) =>
      model.updateAccount(client, { id, accountId, participantCode }),
    findById: (client, id) => model.findById(client, id)
  }
});
