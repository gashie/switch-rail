import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { directoryService } from '../directory/index.js';
import { createOtpClient, OTP_TTL_MS } from './otp-client.js';

export const COOLING_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const REQUEST_COLS = `id, alias_id, from_participant, from_account_id, to_participant,
  to_account_id, initiated_by, status, consent_method, consent_secret,
  consent_expires_at, consented_at, completed_at, rejected_reason, created_at`;

const lastCompletedRequest = async (client, aliasId) => {
  const r = await client.query(
    `SELECT completed_at FROM alias_portability_requests
      WHERE alias_id = $1 AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 1`,
    [aliasId]
  );
  return r.rows[0] || null;
};

const insertRequest = async (
  client,
  {
    id,
    aliasId,
    fromParticipant,
    fromAccountId,
    toParticipant,
    toAccountId,
    initiatedBy,
    consentMethod,
    consentSecret,
    consentExpiresAt
  }
) => {
  const r = await client.query(
    `INSERT INTO alias_portability_requests
       (id, alias_id, from_participant, from_account_id, to_participant, to_account_id,
        initiated_by, status, consent_method, consent_secret, consent_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)
     RETURNING ${REQUEST_COLS}`,
    [
      id,
      aliasId,
      fromParticipant,
      fromAccountId,
      toParticipant,
      toAccountId,
      initiatedBy ?? null,
      consentMethod,
      consentSecret,
      consentExpiresAt
    ]
  );
  return r.rows[0];
};

const findRequestById = async (client, id) => {
  const r = await client.query(
    `SELECT ${REQUEST_COLS} FROM alias_portability_requests WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] || null;
};

export const createPortabilityService = ({ db, aliasesService }) => {
  const otpClient = createOtpClient({ mode: 'fake' });

  return {
    initiate: ({ aliasId, toParticipant, toAccountId, initiatedBy }) =>
      db.withTransaction(async (client) => {
        const alias = await aliasesService._internal.findById(client, aliasId);
        if (!alias) throw new AppError('NOT_FOUND', `alias ${aliasId} not found`, 404);
        if (alias.status !== 'verified') {
          throw new AppError(
            'CONFLICT',
            `alias must be verified before porting (current: ${alias.status})`,
            409
          );
        }
        const last = await lastCompletedRequest(client, aliasId);
        if (last && Date.now() - new Date(last.completed_at).getTime() < COOLING_PERIOD_MS) {
          throw new AppError(
            'CONFLICT',
            'alias is within the 7-day cooling period and cannot be ported again yet',
            409,
            { lastPortedAt: last.completed_at, coolingPeriodMs: COOLING_PERIOD_MS }
          );
        }
        if (alias.account_id === toAccountId) {
          throw new AppError(
            'VALIDATION_FAILED',
            'target account is the alias\'s current account',
            400
          );
        }

        const targetAccount = await directoryService.findById(toAccountId, client);
        if (!targetAccount) {
          throw new AppError('NOT_FOUND', `target account ${toAccountId} not found`, 404);
        }
        if (targetAccount.status !== 'active') {
          throw new AppError(
            'CONFLICT',
            `target account is ${targetAccount.status}, must be active`,
            409
          );
        }
        if (targetAccount.participant_code !== toParticipant) {
          throw new AppError(
            'VALIDATION_FAILED',
            `target account belongs to ${targetAccount.participant_code}, not ${toParticipant}`,
            400
          );
        }

        const { code } = await otpClient.sendOtp({ phone: alias.alias_value });
        const id = uuidv7();
        const request = await insertRequest(client, {
          id,
          aliasId,
          fromParticipant: alias.participant_code,
          fromAccountId: alias.account_id,
          toParticipant,
          toAccountId,
          initiatedBy,
          consentMethod: 'OTP',
          consentSecret: code,
          consentExpiresAt: new Date(Date.now() + OTP_TTL_MS)
        });
        await auditService.record(client, {
          actorType: 'user',
          actorId: initiatedBy,
          eventType: 'alias.port.initiated',
          resourceType: 'alias',
          resourceId: aliasId,
          payload: {
            requestId: id,
            from: alias.participant_code,
            to: toParticipant
          }
        });
        return { request, devCode: code };
      }),

    consent: ({ requestId, code }) =>
      db.withTransaction(async (client) => {
        const request = await findRequestById(client, requestId);
        if (!request) throw new AppError('NOT_FOUND', `port request ${requestId} not found`, 404);
        if (request.status !== 'pending') {
          throw new AppError('CONFLICT', `port request is ${request.status}`, 409);
        }
        if (
          request.consent_expires_at &&
          new Date(request.consent_expires_at).getTime() <= Date.now()
        ) {
          await client.query(
            `UPDATE alias_portability_requests SET status = 'expired' WHERE id = $1`,
            [requestId]
          );
          throw new AppError('CONFLICT', 'port consent expired', 409);
        }
        if (request.consent_method === 'OTP') {
          if (request.consent_secret !== String(code)) {
            throw new AppError('UNAUTHORIZED', 'consent code is incorrect', 401);
          }
        } else {
          throw new AppError(
            'CONFLICT',
            `consent_method ${request.consent_method} not supported in this build`,
            409
          );
        }

        // Atomic move: update alias, mark request consented + completed, audit.
        const updatedAlias = await aliasesService._internal.updateAccount(client, {
          id: request.alias_id,
          accountId: request.to_account_id,
          participantCode: request.to_participant
        });
        await client.query(
          `UPDATE alias_portability_requests
             SET status = 'completed', consented_at = now(), completed_at = now()
           WHERE id = $1`,
          [requestId]
        );
        await auditService.record(client, {
          actorType: 'user',
          eventType: 'alias.ported',
          resourceType: 'alias',
          resourceId: request.alias_id,
          payload: {
            requestId,
            fromParticipant: request.from_participant,
            toParticipant: request.to_participant,
            fromAccountId: request.from_account_id,
            toAccountId: request.to_account_id
          }
        });
        return { request: { ...request, status: 'completed' }, alias: updatedAlias };
      }),

    getRequest: (requestId) =>
      db.withClient(async (client) => {
        const r = await findRequestById(client, requestId);
        if (!r) throw new AppError('NOT_FOUND', `port request ${requestId} not found`, 404);
        return r;
      })
  };
};
