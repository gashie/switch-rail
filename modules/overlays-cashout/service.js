import { randomInt } from 'node:crypto';
import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import * as db from '../../core/db.js';
import { config } from '../../core/config.js';
import { auditService } from '../audit/index.js';
import { directoryService } from '../directory/index.js';
import { createEnvelope } from '../envelope/index.js';
import { transactionsOrchestrator } from '../transactions/index.js';
import { OVERLAY_TYPE, OTP_DIGITS } from './codes.js';
import { STATES, isTerminal, canTransition } from './states.js';

const monthBucket = (d = new Date()) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const formatRequestNumber = (bucket, seq) => `CSH-${bucket}-${String(seq).padStart(6, '0')}`;

const generateOtp = () => {
  // 6-digit OTP, leading-zero preserved.
  const max = 10 ** OTP_DIGITS;
  return String(randomInt(0, max)).padStart(OTP_DIGITS, '0');
};

// Counter durability: bump attempts in a separate connection so the count is
// preserved even if the surrounding consume transaction rolls back on a
// throw (e.g. wrong OTP).
const bumpOtpAttemptOnSeparateConnection = (model, id) =>
  db.withClient((c) => model.bumpOtpAttempt(c, id));

export const createCashoutService = ({ db: dbm, model }) => {
  const initiate = async ({
    customerParticipant, customerAccountNumber,
    agentParticipant, agentFloatAccountNumber,
    amountMinor, currency, expiresInMinutes
  }) => {
    const customerAccount = await directoryService.findByAccount({
      participantCode: customerParticipant,
      accountNumber: customerAccountNumber
    });
    if (!customerAccount) {
      throw new AppError('NOT_FOUND', `customer account not found`, 404);
    }
    const agentFloat = await directoryService.findByAccount({
      participantCode: agentParticipant,
      accountNumber: agentFloatAccountNumber
    });
    if (!agentFloat) {
      throw new AppError('NOT_FOUND', `agent float account not found`, 404);
    }
    if (agentFloat.account_type !== 'AGENT_FLOAT') {
      throw new AppError(
        'VALIDATION_FAILED',
        `agent account ${agentFloatAccountNumber} is type ${agentFloat.account_type}, expected AGENT_FLOAT`,
        400
      );
    }
    const expiresAt = new Date(Date.now() + (expiresInMinutes ?? config.cashoutOtpExpiresInMinutes) * 60_000).toISOString();
    const otp = generateOtp();
    const otpExpiresAt = expiresAt; // OTP and request expire together for simplicity.

    return dbm.withTransaction(async (client) => {
      const bucket = monthBucket();
      const seq = await model.bumpSequence(client, bucket);
      const id = uuidv7();
      const inserted = await model.insert(client, {
        id,
        requestNumber: formatRequestNumber(bucket, seq),
        customerParticipant,
        customerAccountId: customerAccount.id,
        agentParticipant,
        agentFloatAccountId: agentFloat.id,
        amountMinor,
        currency,
        expiresAt,
        otp,
        otpExpiresAt
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'cashout.initiated',
        resourceType: 'cashout_request',
        resourceId: id,
        payload: { requestNumber: inserted.request_number, customerParticipant, agentParticipant }
      });
      return inserted;
    });
  };

  const authorize = async ({ requestNumber, authorizedByUser }) =>
    dbm.withTransaction(async (client) => {
      const r = await model.findByNumber(client, requestNumber);
      if (!r) throw new AppError('NOT_FOUND', `cashout ${requestNumber} not found`, 404);
      if (r.state !== STATES.INITIATED) {
        throw new AppError('CONFLICT', `authorize requires INITIATED, got ${r.state}`, 409);
      }
      if (new Date(r.expires_at).getTime() <= Date.now()) {
        await model.setState(client, { id: r.id, toState: STATES.EXPIRED });
        throw new AppError('CONFLICT', 'cashout expired', 409);
      }
      const updated = await model.setState(client, {
        id: r.id,
        toState: STATES.AUTHORIZED,
        fields: { authorized_at: new Date().toISOString() }
      });
      await auditService.record(client, {
        actorType: authorizedByUser ? 'user' : 'system',
        actorId: authorizedByUser || null,
        eventType: 'cashout.authorized',
        resourceType: 'cashout_request',
        resourceId: r.id,
        payload: { requestNumber }
      });
      return updated;
    });

  const complete = async ({ requestNumber, otp, customerName }) => {
    // Step 1: read state + check OTP + counter durability bump (separate conn).
    const pre = await dbm.withClient((c) => model.findByNumber(c, requestNumber));
    if (!pre) throw new AppError('NOT_FOUND', `cashout ${requestNumber} not found`, 404);
    if (pre.state !== STATES.AUTHORIZED) {
      throw new AppError('CONFLICT', `complete requires AUTHORIZED, got ${pre.state}`, 409);
    }
    if (new Date(pre.expires_at).getTime() <= Date.now()) {
      await dbm.withTransaction((c) => model.setState(c, { id: pre.id, toState: STATES.EXPIRED }));
      throw new AppError('CONFLICT', 'cashout expired', 409);
    }
    if (pre.agent_otp_attempts >= config.cashoutOtpMaxAttempts) {
      await dbm.withTransaction((c) => model.setState(c, { id: pre.id, toState: STATES.CANCELLED, fields: { cancelled_at: new Date().toISOString() } }));
      throw new AppError('TOO_MANY_ATTEMPTS', 'OTP attempts exhausted; request cancelled', 429);
    }
    // Bump first so the count is durable even if OTP is wrong.
    await bumpOtpAttemptOnSeparateConnection(model, pre.id);
    if (pre.agent_otp !== otp) {
      throw new AppError('INVALID_OTP', 'OTP does not match', 400);
    }

    // Step 2: build CRDT_TRF customer→agent_float and run orchestrator.
    const customerAccount = await directoryService.findById(pre.customer_account_id);
    const agentFloat = await directoryService.findById(pre.agent_float_account_id);
    if (!customerAccount || !agentFloat) {
      throw new AppError('NOT_FOUND', 'cashout party account missing', 404);
    }
    const envelope = createEnvelope({
      msgType: 'CRDT_TRF',
      sourceFormat: 'REST',
      sourceMessageId: `csh-${pre.id}-${Date.now()}`,
      endToEndId: `csh-${pre.id}`,
      idempotencyKey: `csh-${pre.id}`,
      originator: {
        participantCode: pre.customer_participant,
        accountId: customerAccount.account_number,
        accountType: customerAccount.account_type,
        name: customerName,
        countryCode: 'GH'
      },
      beneficiary: {
        // The envelope schema only allows BANK_ACCOUNT/WALLET/ALIAS. The
        // AGENT_FLOAT distinction lives in the directory + this overlay's
        // initiate-time check; the wire-format envelope flattens to BANK_ACCOUNT.
        participantCode: pre.agent_participant,
        accountId: agentFloat.account_number,
        accountType: 'BANK_ACCOUNT',
        name: agentFloat.account_name,
        countryCode: 'GH'
      },
      amount: { value: String(pre.amount_minor), currency: pre.currency },
      reference: `Cashout ${pre.request_number}`,
      purposeCode: 'GDDS',
      settlementMethod: 'CLRG',
      metadata: { overlay: { type: OVERLAY_TYPE, overlayId: pre.id, requestNumber: pre.request_number } }
    });
    const result = await transactionsOrchestrator.process(envelope);
    const tx = result.transaction;

    return dbm.withTransaction(async (client) => {
      let updated;
      if (tx.state === 'CONFIRMED') {
        if (!canTransition(STATES.AUTHORIZED, STATES.COMPLETED)) {
          throw new AppError('CONFLICT', 'invalid transition', 409);
        }
        updated = await model.setState(client, {
          id: pre.id,
          toState: STATES.COMPLETED,
          fields: {
            completed_at: new Date().toISOString(),
            transaction_id: tx.id,
            agent_otp: null
          }
        });
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'cashout.completed',
          resourceType: 'cashout_request',
          resourceId: pre.id,
          payload: { requestNumber: pre.request_number, transactionId: tx.id }
        });
      } else {
        // The cashout stays AUTHORIZED — agent can retry until expiry. Audit
        // the failed attempt so we have a record.
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'cashout.complete_failed',
          resourceType: 'cashout_request',
          resourceId: pre.id,
          payload: { requestNumber: pre.request_number, txState: tx.state, reasonCode: tx.reason_code }
        });
        updated = pre;
      }
      return { request: updated, transaction: tx };
    });
  };

  const cancel = async ({ requestNumber, cancelledBy, reason, cancelledByUser }) =>
    dbm.withTransaction(async (client) => {
      const r = await model.findByNumber(client, requestNumber);
      if (!r) throw new AppError('NOT_FOUND', `cashout ${requestNumber} not found`, 404);
      if (isTerminal(r.state)) {
        throw new AppError('CONFLICT', `cashout ${requestNumber} is in terminal state ${r.state}`, 409);
      }
      const updated = await model.setState(client, {
        id: r.id,
        toState: STATES.CANCELLED,
        fields: { cancelled_at: new Date().toISOString() }
      });
      await auditService.record(client, {
        actorType: cancelledByUser ? 'user' : 'system',
        actorId: cancelledByUser || null,
        eventType: 'cashout.cancelled',
        resourceType: 'cashout_request',
        resourceId: r.id,
        payload: { requestNumber, cancelledBy, reason }
      });
      return updated;
    });

  const findByNumber = (n) => dbm.withClient((c) => model.findByNumber(c, n));
  const findById = (id) => dbm.withClient((c) => model.findById(c, id));
  const list = (filters) => dbm.withClient((c) => model.list(c, filters));

  const expirePast = async () =>
    dbm.withTransaction(async (client) => {
      const expired = await model.expirePast(client, 500);
      for (const e of expired) {
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'cashout.expired',
          resourceType: 'cashout_request',
          resourceId: e.id,
          payload: { requestNumber: e.request_number }
        });
      }
      return { count: expired.length };
    });

  return { initiate, authorize, complete, cancel, list, findByNumber, findById, expirePast };
};
