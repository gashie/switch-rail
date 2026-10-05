import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { config } from '../../core/config.js';
import { auditService } from '../audit/index.js';
import { directoryService, normalizeName } from '../directory/index.js';
import { createNiaClient } from './nia-client.js';
import { createOtpClient, OTP_TTL_MS, OTP_MAX_ATTEMPTS } from './otp-client.js';
import { createEmailLinkClient, EMAIL_TOKEN_TTL_MS } from './email-link-client.js';

const CHALLENGE_COLS =
  'id, alias_id, method, challenge_secret, expires_at, attempts, consumed_at, created_at';

const insertChallenge = async (
  client,
  { id, aliasId, method, challengeSecret, expiresAt }
) => {
  const r = await client.query(
    `INSERT INTO alias_verification_challenges
       (id, alias_id, method, challenge_secret, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${CHALLENGE_COLS}`,
    [id, aliasId, method, challengeSecret, expiresAt]
  );
  return r.rows[0];
};

const findActiveChallenge = async (client, aliasId, method) => {
  const r = await client.query(
    `SELECT ${CHALLENGE_COLS} FROM alias_verification_challenges
      WHERE alias_id = $1 AND method = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [aliasId, method]
  );
  return r.rows[0] || null;
};

const incrementAttempts = async (client, id) => {
  const r = await client.query(
    `UPDATE alias_verification_challenges SET attempts = attempts + 1
      WHERE id = $1 RETURNING attempts`,
    [id]
  );
  return r.rows[0]?.attempts ?? null;
};

const markConsumed = async (client, id) => {
  await client.query(
    `UPDATE alias_verification_challenges SET consumed_at = now() WHERE id = $1`,
    [id]
  );
};

export const createVerificationService = ({ db, aliasesService }) => {
  const niaClient = createNiaClient({ mode: config.niaMode });
  const otpClient = createOtpClient({ mode: 'fake' });
  const emailLinkClient = createEmailLinkClient({ mode: 'fake' });

  const requireAlias = async (client, aliasId) => {
    const alias = await aliasesService._internal.findById(client, aliasId);
    if (!alias) throw new AppError('NOT_FOUND', `alias ${aliasId} not found`, 404);
    return alias;
  };

  return {
    startOtp: ({ aliasId }) =>
      db.withTransaction(async (client) => {
        const alias = await requireAlias(client, aliasId);
        if (alias.alias_type !== 'PHONE') {
          throw new AppError(
            'VALIDATION_FAILED',
            `OTP is only available for PHONE aliases (this alias is ${alias.alias_type})`,
            400
          );
        }
        if (alias.status !== 'pending') {
          throw new AppError(
            'CONFLICT',
            `alias is ${alias.status}, OTP can only start for pending aliases`,
            409
          );
        }
        const { code } = await otpClient.sendOtp({ phone: alias.alias_value });
        const challenge = await insertChallenge(client, {
          id: uuidv7(),
          aliasId,
          method: 'OTP',
          challengeSecret: code,
          expiresAt: new Date(Date.now() + OTP_TTL_MS)
        });
        return {
          challengeId: challenge.id,
          ttlMs: OTP_TTL_MS,
          maxAttempts: OTP_MAX_ATTEMPTS,
          // Dev-only field — exposed because the OTP client is the fake.
          // Production providers send the OTP via SMS and the rail does NOT
          // know the code; this field is absent in those builds.
          devCode: code
        };
      }),

    consumeOtp: async ({ aliasId, code }) => {
      // Pre-check + attempt-increment runs in its own connection so a wrong
      // code commits the attempts++ even though the call rejects. Verification
      // success then takes a fresh transaction to mark consumed + verified.
      const preCheck = await db.withClient(async (client) => {
        const alias = await requireAlias(client, aliasId);
        if (alias.alias_type !== 'PHONE') {
          throw new AppError('VALIDATION_FAILED', 'alias is not a PHONE', 400);
        }
        if (alias.status === 'verified') return { shortCircuit: { alias } };
        const challenge = await findActiveChallenge(client, aliasId, 'OTP');
        if (!challenge) {
          throw new AppError(
            'NOT_FOUND',
            `no active OTP challenge for alias ${aliasId}`,
            404
          );
        }
        if (new Date(challenge.expires_at).getTime() <= Date.now()) {
          await markConsumed(client, challenge.id);
          throw new AppError('CONFLICT', 'OTP challenge expired', 409);
        }
        if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
          await markConsumed(client, challenge.id);
          throw new AppError('CONFLICT', 'OTP max attempts exceeded', 409);
        }
        if (challenge.challenge_secret !== String(code)) {
          const attempts = await incrementAttempts(client, challenge.id);
          if (attempts >= OTP_MAX_ATTEMPTS) {
            await markConsumed(client, challenge.id);
          }
          throw new AppError('UNAUTHORIZED', 'OTP code is incorrect', 401, {
            attempts
          });
        }
        return { challenge };
      });
      if (preCheck.shortCircuit) return preCheck.shortCircuit;

      return db.withTransaction(async (client) => {
        await markConsumed(client, preCheck.challenge.id);
        const updated = await aliasesService._internal.setVerified(client, {
          id: aliasId,
          method: 'OTP'
        });
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'alias.verified',
          resourceType: 'alias',
          resourceId: aliasId,
          payload: { method: 'OTP', aliasType: 'PHONE' }
        });
        return { alias: updated };
      });
    },

    startEmailLink: ({ aliasId }) =>
      db.withTransaction(async (client) => {
        const alias = await requireAlias(client, aliasId);
        if (alias.alias_type !== 'EMAIL') {
          throw new AppError('VALIDATION_FAILED', 'alias is not an EMAIL', 400);
        }
        if (alias.status !== 'pending') {
          throw new AppError('CONFLICT', `alias is ${alias.status}`, 409);
        }
        const { token } = await emailLinkClient.sendLink({ email: alias.alias_value });
        const challenge = await insertChallenge(client, {
          id: uuidv7(),
          aliasId,
          method: 'EMAIL_LINK',
          challengeSecret: token,
          expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS)
        });
        return { challengeId: challenge.id, ttlMs: EMAIL_TOKEN_TTL_MS, devToken: token };
      }),

    consumeEmailLink: ({ aliasId, token }) =>
      db.withTransaction(async (client) => {
        const alias = await requireAlias(client, aliasId);
        if (alias.alias_type !== 'EMAIL') {
          throw new AppError('VALIDATION_FAILED', 'alias is not an EMAIL', 400);
        }
        if (alias.status === 'verified') return { alias };
        const challenge = await findActiveChallenge(client, aliasId, 'EMAIL_LINK');
        if (!challenge) {
          throw new AppError(
            'NOT_FOUND',
            `no active email-link challenge for alias ${aliasId}`,
            404
          );
        }
        if (new Date(challenge.expires_at).getTime() <= Date.now()) {
          await markConsumed(client, challenge.id);
          throw new AppError('CONFLICT', 'email link expired', 409);
        }
        if (challenge.challenge_secret !== String(token)) {
          await incrementAttempts(client, challenge.id);
          throw new AppError('UNAUTHORIZED', 'email link token is incorrect', 401);
        }
        await markConsumed(client, challenge.id);
        const updated = await aliasesService._internal.setVerified(client, {
          id: aliasId,
          method: 'EMAIL_LINK'
        });
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'alias.verified',
          resourceType: 'alias',
          resourceId: aliasId,
          payload: { method: 'EMAIL_LINK', aliasType: 'EMAIL' }
        });
        return { alias: updated };
      }),

    verifyGhanacard: ({ aliasId }) =>
      db.withTransaction(async (client) => {
        const alias = await requireAlias(client, aliasId);
        if (alias.alias_type !== 'GHANACARD') {
          throw new AppError('VALIDATION_FAILED', 'alias is not a GHANACARD', 400);
        }
        if (alias.status === 'verified') return { alias };
        const account = await directoryService.findById(alias.account_id, client);
        if (!account) {
          throw new AppError('NOT_FOUND', `account ${alias.account_id} not found`, 404);
        }
        const result = await niaClient.verify({ ghanacardPin: alias.alias_value });
        if (result.status === 'NOT_FOUND') {
          throw new AppError('NOT_FOUND', 'Ghanacard PIN not found in NIA', 404);
        }
        if (result.status !== 'EXACT_MATCH') {
          throw new AppError('UNAUTHORIZED', `NIA verification ${result.status}`, 401, {
            niaStatus: result.status,
            niaFields: result.fields
          });
        }
        const niaName = normalizeName(`${result.canonical.firstName} ${result.canonical.lastName}`);
        const accountNorm = account.account_name_normalized;
        const niaTokens = niaName.split(' ').filter(Boolean);
        const accountTokens = new Set(accountNorm.split(' ').filter(Boolean));
        const allMatch = niaTokens.every((t) => accountTokens.has(t));
        if (!allMatch) {
          throw new AppError(
            'UNAUTHORIZED',
            'NIA name does not match account holder name',
            401,
            { niaName, accountName: accountNorm }
          );
        }
        const updated = await aliasesService._internal.setVerified(client, {
          id: aliasId,
          method: 'NIA'
        });
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'alias.verified',
          resourceType: 'alias',
          resourceId: aliasId,
          payload: { method: 'NIA', aliasType: 'GHANACARD' }
        });
        return { alias: updated, nia: { name: niaName } };
      })
  };
};
