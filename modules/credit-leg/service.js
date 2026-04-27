import { AppError } from '../../core/errors.js';
import { canonicalJsonBytes } from '../../core/json.js';
import { CATEGORY, REASON_TO_CATEGORY } from '../../core/codes.js';
import { uuidv7 } from '../../core/uuid.js';
import { config } from '../../core/config.js';
import { cryptoKeysService } from '../crypto-keys/index.js';
import { participantsService } from '../participants/index.js';
import { transactionsService } from '../transactions/index.js';
import { envelopeService } from '../envelope/index.js';
import { byName as railClassByName } from '../rail-orchestration/index.js';
import { withTimeout } from './timeout.js';

// Reverse map of core/codes.js REASON_TO_ISO_REASON. Multiple internal
// reasons collapse to the same ISO code (e.g. TIMEOUT/UNREACHABLE/INTERNAL
// all → XT99); on inbound we recover them by leaning on the simulator's
// behaviour signal where available, but for a real participant we map to
// the safest semantic of the ISO code.
const ISO_TO_INTERNAL = Object.freeze({
  AC01: 'BENEFICIARY_ACCOUNT_NOT_FOUND',
  AC04: 'BENEFICIARY_ACCOUNT_CLOSED',
  AC06: 'BENEFICIARY_ACCOUNT_BLOCKED',
  AG01: 'TRANSACTION_FORBIDDEN',
  AM04: 'INSUFFICIENT_FUNDS',
  AM05: 'DUPLICATE',
  BE01: 'INVALID_END_CUSTOMER',
  DT01: 'INVALID_DATE',
  ED05: 'SETTLEMENT_FAILED',
  FF01: 'INVALID_FORMAT',
  MD07: 'BENEFICIARY_DECEASED',
  RR04: 'REGULATORY',
  TM01: 'CUTOFF_TIME',
  XT99: 'RAIL_INTERNAL_ERROR'
});

const railTimeoutMs = (railClassName) => {
  if (config.txTestMode) return 1500;
  const cls = railClassName ? railClassByName(railClassName) : null;
  return cls?.timeoutMs ?? 10_000;
};

const buildSignedPayload = async ({ transaction, envelope, railKid }) => {
  const payload = {
    envelopeId: envelope.envelopeId,
    transactionId: transaction.id,
    endToEndId: envelope.endToEndId,
    amount: envelope.amount,
    originator: {
      participantCode: envelope.originator.participantCode,
      accountId: envelope.originator.accountId,
      name: envelope.originator.name
    },
    beneficiary: {
      participantCode: envelope.beneficiary.participantCode,
      accountId: envelope.beneficiary.accountId,
      name: envelope.beneficiary.name
    },
    reference: envelope.reference || '',
    remittance: envelope.remittance || '',
    purposeCode: envelope.purposeCode || '',
    settlementMethod: envelope.settlementMethod || ''
  };
  const bytes = canonicalJsonBytes(payload);
  const sig = await cryptoKeysService.sign({ kid: railKid, payload: bytes });
  return { payload, bytes, signature: sig };
};

const findRailKid = async () => {
  const keys = await cryptoKeysService.listActive({ ownerType: 'rail', ownerId: null });
  if (keys.length === 0) {
    throw new AppError(
      'CONFLICT',
      'no active rail signing key — run `pnpm seed` or call ensureRailKey',
      503
    );
  }
  return keys[0].kid;
};

const interpretResponse = (httpJson) => {
  if (!httpJson || typeof httpJson !== 'object') {
    return {
      category: CATEGORY.AMBIGUOUS,
      reasonCode: 'RAIL_INTERNAL_ERROR',
      raw: httpJson
    };
  }
  if (httpJson.ok === true) {
    const responseCode = httpJson.data?.responseCode;
    if (responseCode === 'ACSC') {
      return {
        category: CATEGORY.TERMINAL_SUCCESS,
        reasonCode: 'SUCCESS',
        creditedAt: httpJson.data?.creditedAt,
        beneficiaryRef: httpJson.data?.beneficiaryRef,
        raw: httpJson
      };
    }
    return {
      category: CATEGORY.AMBIGUOUS,
      reasonCode: 'RAIL_INTERNAL_ERROR',
      raw: httpJson
    };
  }
  const isoCode = httpJson.error?.code;
  const internal = ISO_TO_INTERNAL[isoCode] || 'RAIL_INTERNAL_ERROR';
  return {
    category: REASON_TO_CATEGORY[internal] || CATEGORY.AMBIGUOUS,
    reasonCode: internal,
    raw: httpJson
  };
};

// db is unused — credit-leg now reads envelopes via envelopeService.
// Factory still accepts the deps shape for symmetry with the other modules.
export const createCreditLegService = (_deps = {}) => {
  const run = async ({ transaction, envelope }) => {
    const beneficiaryParticipant = await participantsService.getByCode(
      transaction.beneficiary_participant
    );
    const url = beneficiaryParticipant?.endpoints?.credit_leg;
    if (!url) {
      return {
        category: CATEGORY.AMBIGUOUS,
        reasonCode: 'UNREACHABLE',
        raw: { reason: 'beneficiary participant has no credit_leg endpoint registered' },
        durationMs: 0
      };
    }
    const railKid = await findRailKid();
    const { payload, bytes, signature } = await buildSignedPayload({
      transaction,
      envelope,
      railKid
    });
    const requestId = uuidv7();
    const headers = {
      'content-type': 'application/json',
      'x-sika-signature': signature.signature,
      'x-sika-kid': signature.kid,
      'x-sika-request-id': requestId
    };
    const timeoutMs = railTimeoutMs(transaction.rail_class);

    const t0 = Date.now();
    const controller = new AbortController();
    const fetchPromise = (async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: bytes,
        signal: controller.signal
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        return { ok: false, error: { code: 'XT99', message: `non-JSON body: ${text.slice(0, 80)}` } };
      }
      return json;
    })();

    let httpJson;
    try {
      httpJson = await withTimeout(fetchPromise, timeoutMs, () => {
        controller.abort();
        const err = new Error('credit-leg deadline exceeded');
        err._sika_kind = 'TIMEOUT';
        return err;
      });
    } catch (e) {
      const elapsed = Date.now() - t0;
      const isTimeout = e?._sika_kind === 'TIMEOUT' || e?.name === 'AbortError';
      const isNetwork = !isTimeout;
      return {
        category: CATEGORY.AMBIGUOUS,
        reasonCode: isTimeout ? 'TIMEOUT' : 'UNREACHABLE',
        raw: { error: e?.message || String(e), kind: isTimeout ? 'timeout' : (isNetwork ? 'network' : 'unknown') },
        durationMs: elapsed,
        requestId
      };
    }
    const elapsed = Date.now() - t0;
    return { ...interpretResponse(httpJson), durationMs: elapsed, requestId, requestPayload: payload };
  };

  const runById = async (transactionId) => {
    const tx = await transactionsService.findById(transactionId);
    if (!tx) throw new AppError('NOT_FOUND', `transaction ${transactionId} not found`, 404);
    const env = await envelopeService.findByEnvelopeId(tx.envelope_id);
    if (!env) throw new AppError('NOT_FOUND', `envelope ${tx.envelope_id} not found`, 404);
    return run({ transaction: tx, envelope: env });
  };

  return { run, runById };
};
