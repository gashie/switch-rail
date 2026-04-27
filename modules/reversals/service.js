import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { canonicalJsonBytes } from '../../core/json.js';
import { config } from '../../core/config.js';
import { CATEGORY } from '../../core/codes.js';
import { auditService } from '../audit/index.js';
import { participantsService } from '../participants/index.js';
import { transactionsService } from '../transactions/index.js';
import { cryptoKeysService } from '../crypto-keys/index.js';
import { withTimeout } from '../credit-leg/index.js';
import { byName as railClassByName } from '../rail-orchestration/index.js';
import { REASON_CODES } from './schema.js';

const REVERSAL_TIMEOUT_FALLBACK_MS = 10_000;

const railTimeoutMs = (railClassName) => {
  if (config.txTestMode) return 1500;
  const cls = railClassName ? railClassByName(railClassName) : null;
  return cls?.timeoutMs ?? REVERSAL_TIMEOUT_FALLBACK_MS;
};

const findRailKid = async () => {
  const keys = await cryptoKeysService.listActive({ ownerType: 'rail', ownerId: null });
  if (keys.length === 0) {
    throw new AppError('CONFLICT', 'no active rail signing key — reversal cannot be signed', 503);
  }
  return keys[0].kid;
};

const buildReversalPayload = ({ original, reversal, reasonCode }) => ({
  originalTransactionId: original.id,
  reversalTransactionId: reversal.id,
  reasonCode,
  amount: {
    value: String(reversal.amount_value),
    currency: reversal.amount_currency
  },
  beneficiary: {
    participantCode: reversal.beneficiary_participant,
    accountId: reversal.beneficiary_account
  },
  originator: {
    participantCode: reversal.originator_participant,
    accountId: reversal.originator_account
  }
});

const callParticipantReversal = async ({ url, payload, railKid, timeoutMs }) => {
  const bytes = canonicalJsonBytes(payload);
  const sig = await cryptoKeysService.sign({ kid: railKid, payload: bytes });
  const requestId = uuidv7();
  const controller = new AbortController();
  const t0 = Date.now();
  const fetchPromise = (async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sika-signature': sig.signature,
        'x-sika-kid': sig.kid,
        'x-sika-request-id': requestId
      },
      body: bytes,
      signal: controller.signal
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: { code: 'XT99', message: `non-JSON: ${text.slice(0, 80)}` } };
    }
  })();
  try {
    const json = await withTimeout(fetchPromise, timeoutMs, () => {
      controller.abort();
      const err = new Error('reversal deadline exceeded');
      err._sika_kind = 'TIMEOUT';
      return err;
    });
    return { ok: !!json?.ok, body: json, durationMs: Date.now() - t0, requestId };
  } catch (e) {
    return {
      ok: false,
      body: { ok: false, error: { code: 'XT99', message: e?.message || String(e) } },
      durationMs: Date.now() - t0,
      requestId,
      kind: e?._sika_kind || 'network'
    };
  }
};

export const createReversalsService = ({ db, model }) => {
  const initiateOnClient = async (client, { originalTxId, reasonCode, reasonMessage, initiatedBy }) => {
    if (!REASON_CODES.includes(reasonCode)) {
      throw new AppError('VALIDATION_FAILED', `invalid reversal reasonCode: ${reasonCode}`, 400);
    }
    const original = await transactionsService.findById(originalTxId, client);
    if (!original) {
      throw new AppError('NOT_FOUND', `original transaction ${originalTxId} not found`, 404);
    }
    if (original.state !== 'CONFIRMED') {
      throw new AppError(
        'CONFLICT',
        `cannot reverse a transaction in state ${original.state} (must be CONFIRMED)`,
        409
      );
    }
    if (original.original_transaction_id) {
      throw new AppError(
        'CONFLICT',
        `transaction ${originalTxId} is itself a reversal — cannot reverse a reversal`,
        409
      );
    }
    if (original.reversal_transaction_id) {
      throw new AppError(
        'CONFLICT',
        `transaction ${originalTxId} already has reversal ${original.reversal_transaction_id}`,
        409
      );
    }

    // 1. Create the reversal transaction with originator/beneficiary swapped.
    const reversalId = uuidv7();
    await transactionsService._internal.insertReversal(client, {
      id: reversalId,
      envelopeId: original.envelope_id, // shared envelope; the link is via original_transaction_id
      endToEndId: `${original.end_to_end_id}-rev`,
      state: 'RECEIVED',
      railClass: original.rail_class,
      originatorParticipant: original.beneficiary_participant,
      originatorAccount: original.beneficiary_account,
      beneficiaryParticipant: original.originator_participant,
      beneficiaryAccount: original.originator_account,
      amountValue: original.amount_value,
      amountCurrency: original.amount_currency,
      originalTransactionId: original.id
    });

    await auditService.record(client, {
      actorType: initiatedBy?.startsWith('operator:') ? 'user' : 'system',
      actorId: initiatedBy?.startsWith('operator:') ? initiatedBy.slice(9) : null,
      eventType: 'transaction.reversal.initiated',
      resourceType: 'transaction',
      resourceId: reversalId,
      payload: {
        originalTransactionId: original.id,
        reasonCode,
        reasonMessage: reasonMessage || null
      }
    });

    // 2. Move through the standard non-credit-leg states fast — reversals
    //    are operator/recovery initiated and don't re-run the auth pipeline.
    let reversal = await transactionsService._internal.transitionOnClient(
      client,
      reversalId,
      'AUTHORIZED',
      {
        occurredBy: initiatedBy || 'system',
        payload: { reversal: true, reasonCode }
      }
    );
    reversal = await transactionsService._internal.transitionOnClient(
      client,
      reversalId,
      'ROUTED',
      {
        occurredBy: initiatedBy || 'system',
        payload: { reversal: true, reasonCode }
      }
    );
    reversal = await transactionsService._internal.transitionOnClient(
      client,
      reversalId,
      'CREDIT_LEG_PENDING',
      {
        occurredBy: initiatedBy || 'system',
        payload: { reversal: true, reasonCode }
      }
    );

    // 3. Call the participant's reversal endpoint. The "beneficiary" of
    //    the reversal txn is the original originator — which is the party
    //    being credited back. So the call goes to the original
    //    *beneficiary's* reversal endpoint (whose money we're clawing back).
    const reversalTargetParticipant = await participantsService.getByCode(
      original.beneficiary_participant
    );
    const url = reversalTargetParticipant?.endpoints?.reversal;
    let callResult;
    if (!url) {
      callResult = {
        ok: false,
        body: {
          ok: false,
          error: { code: 'XT99', message: 'beneficiary participant has no reversal endpoint registered' }
        },
        durationMs: 0
      };
    } else {
      const railKid = await findRailKid();
      const payload = buildReversalPayload({ original, reversal, reasonCode });
      callResult = await callParticipantReversal({
        url,
        payload,
        railKid,
        timeoutMs: railTimeoutMs(reversal.rail_class)
      });
    }

    await auditService.record(client, {
      actorType: 'system',
      eventType: 'transaction.reversal.callback',
      resourceType: 'transaction',
      resourceId: reversalId,
      payload: {
        ok: callResult.ok,
        durationMs: callResult.durationMs,
        reasonCode
      }
    });

    if (callResult.ok) {
      // Reversal call succeeded — confirm the reversal txn and unwind original.
      reversal = await transactionsService._internal.transitionOnClient(
        client,
        reversalId,
        'CONFIRMED',
        {
          responseCode: 'ACSC',
          reasonCode: 'SUCCESS',
          occurredBy: initiatedBy || 'system',
          payload: {
            reversal: true,
            originalTransactionId: original.id,
            reasonCode
          }
        }
      );
      await model.setReversalLink(client, original.id, reversalId);
      await transactionsService._internal.transitionOnClient(
        client,
        original.id,
        'REVERSED',
        {
          reasonCode,
          reasonMessage: reasonMessage || `reversed by ${reasonCode}`,
          responseCode: 'ACSC',
          occurredBy: initiatedBy || 'system',
          payload: { reversalTransactionId: reversalId }
        }
      );
      return {
        reversal,
        originalUpdated: await transactionsService.findById(original.id, client),
        category: CATEGORY.TERMINAL_SUCCESS
      };
    }

    // Failure — leave the reversal txn REJECTED. Original stays CONFIRMED so
    // an operator can retry or escalate.
    reversal = await transactionsService._internal.transitionOnClient(
      client,
      reversalId,
      'REJECTED',
      {
        responseCode: 'RJCT',
        reasonCode: 'TECH',
        reasonMessage: callResult.body?.error?.message || 'reversal call failed',
        occurredBy: initiatedBy || 'system',
        payload: {
          reversal: true,
          originalTransactionId: original.id,
          requestedReason: reasonCode,
          callError: callResult.body?.error || null
        }
      }
    );
    return {
      reversal,
      originalUpdated: original,
      category: CATEGORY.TERMINAL_FAIL
    };
  };

  const initiate = (input) =>
    db.withTransaction((client) => initiateOnClient(client, input));

  const findById = (id) => db.withClient((c) => model.findById(c, id));

  const listForOriginal = (originalTxId) =>
    db.withClient((c) => model.listByOriginal(c, originalTxId));

  return {
    initiate,
    findById,
    listForOriginal,
    REASON_CODES
  };
};
