import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { canonicalJsonBytes } from '../../core/json.js';
import { config } from '../../core/config.js';
import { auditService } from '../audit/index.js';
import { participantsService } from '../participants/index.js';
import { transactionsService } from '../transactions/index.js';
import { reversalsService } from '../reversals/index.js';
import { cryptoKeysService } from '../crypto-keys/index.js';
import { withTimeout } from '../credit-leg/index.js';

const findRailKid = async () => {
  const keys = await cryptoKeysService.listActive({ ownerType: 'rail', ownerId: null });
  if (keys.length === 0) {
    throw new AppError('CONFLICT', 'no active rail signing key', 503);
  }
  return keys[0].kid;
};

const callFreeze = async ({ url, payload, railKid, timeoutMs }) => {
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
      const err = new Error('freeze deadline exceeded');
      err._sika_kind = 'TIMEOUT';
      return err;
    });
    return { ok: !!json?.ok, body: json, durationMs: Date.now() - t0, kind: 'response' };
  } catch (e) {
    return {
      ok: false,
      body: { ok: false, error: { code: 'XT99', message: e?.message || String(e) } },
      durationMs: Date.now() - t0,
      kind: e?._sika_kind === 'TIMEOUT' ? 'timeout' : 'network'
    };
  }
};

const ageInDays = (timestamp) => {
  if (!timestamp) return Infinity;
  const t = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  return Math.floor((Date.now() - t) / 86_400_000);
};

export const createFastTrackService = ({ db, model }) => {
  const invoke = ({ originalTransactionId, evidence, reasonCode, reasonMessage, invokedBy, victimParticipant }) =>
    db.withTransaction(async (client) => {
      const original = await transactionsService.findById(originalTransactionId, client);
      if (!original) {
        throw new AppError('NOT_FOUND', `transaction ${originalTransactionId} not found`, 404);
      }
      if (original.state !== 'CONFIRMED') {
        throw new AppError(
          'CONFLICT',
          `fast-track invoke requires CONFIRMED original (state=${original.state})`,
          409
        );
      }
      if (ageInDays(original.confirmed_at) > config.fastTrackReversalWindowDays) {
        throw new AppError(
          'CONFLICT',
          `original transaction is older than ${config.fastTrackReversalWindowDays} days`,
          409
        );
      }
      const victim = victimParticipant || original.originator_participant;
      if (victim !== original.originator_participant) {
        throw new AppError(
          'CONFLICT',
          'fast-track may only be invoked by the original originator participant',
          409
        );
      }
      // Quota check.
      const used = await model.countInvocationsThisMonth(client, victim);
      if (used >= config.fastTrackInvokeMonthlyQuota) {
        throw new AppError(
          'CONFLICT',
          `participant ${victim} reached monthly fast-track quota (${config.fastTrackInvokeMonthlyQuota})`,
          429
        );
      }

      const ftr = await model.insert(client, {
        id: uuidv7(),
        originalTransactionId,
        victimParticipant: victim,
        receivingParticipant: original.beneficiary_participant,
        invokedBy: invokedBy ?? null,
        evidence,
        reasonCode,
        reasonMessage
      });

      await auditService.record(client, {
        actorType: invokedBy ? 'user' : 'system',
        actorId: invokedBy || null,
        eventType: 'fast_track.invoked',
        resourceType: 'fast_track_reversal',
        resourceId: ftr.id,
        payload: {
          originalTransactionId,
          victim,
          receiving: original.beneficiary_participant,
          reasonCode
        }
      });

      // Call receiving participant's freeze endpoint. This is the holding
      // action — the actual reversal happens via confirmReversal below
      // (audit-event-then-operator-confirm rule).
      const receiving = await participantsService.getByCode(original.beneficiary_participant);
      const url = receiving?.endpoints?.freeze;
      let freezeResult;
      if (!url) {
        freezeResult = {
          ok: false,
          body: { ok: false, error: { code: 'XT99', message: 'no freeze endpoint' } },
          kind: 'no_endpoint'
        };
      } else {
        const railKid = await findRailKid();
        const timeoutMs = config.txTestMode ? 1500 : 10_000;
        freezeResult = await callFreeze({
          url,
          payload: {
            accountId: original.beneficiary_account,
            holdAmountMinor: String(original.amount_value),
            currency: original.amount_currency,
            reason: reasonCode,
            originalTransactionId
          },
          railKid,
          timeoutMs
        });
      }

      // Single retry on timeout.
      if (!freezeResult.ok && freezeResult.kind === 'timeout' && url) {
        const railKid = await findRailKid();
        freezeResult = await callFreeze({
          url,
          payload: {
            accountId: original.beneficiary_account,
            holdAmountMinor: String(original.amount_value),
            currency: original.amount_currency,
            reason: reasonCode,
            originalTransactionId
          },
          railKid,
          timeoutMs: config.txTestMode ? 1500 : 10_000
        });
      }

      const updates = { freeze_attempted_at: new Date().toISOString() };
      let nextState;
      if (freezeResult.ok) {
        nextState = 'frozen';
        updates.receiving_acknowledged_at = new Date().toISOString();
      } else if (freezeResult.kind === 'timeout') {
        nextState = 'expired';
      } else {
        nextState = 'rejected';
        updates.reason_message = freezeResult.body?.error?.message || 'freeze rejected';
      }

      const updated = await model.setState(client, { id: ftr.id, state: nextState, fields: updates });

      await auditService.record(client, {
        actorType: 'system',
        eventType: `fast_track.${nextState}`,
        resourceType: 'fast_track_reversal',
        resourceId: ftr.id,
        payload: {
          originalTransactionId,
          freezeKind: freezeResult.kind,
          freezeOk: freezeResult.ok
        }
      });

      return { ftr: updated, freezeResult };
    });

  // Conservative-reversal: a successful freeze does NOT auto-execute the
  // reversal. Operator (or future fraud-confirmed automation) calls
  // confirmReversal to walk the standard reversals.initiate flow.
  const confirmReversal = ({ id, confirmedBy }) =>
    db.withTransaction(async (client) => {
      const ftr = await model.findById(client, id);
      if (!ftr) throw new AppError('NOT_FOUND', `fast-track ${id} not found`, 404);
      if (ftr.state !== 'frozen') {
        throw new AppError(
          'CONFLICT',
          `fast-track ${id} is in state ${ftr.state}; only 'frozen' is reversible`,
          409
        );
      }
      // Hand off to the regular reversals service.
      const reversal = await reversalsService.initiate({
        originalTxId: ftr.original_transaction_id,
        reasonCode: 'FRAD',
        reasonMessage: `fast-track confirmed: ${ftr.reason_code}`,
        initiatedBy: confirmedBy ? `operator:${confirmedBy}` : 'system'
      });

      const updated = await model.setState(client, {
        id,
        state: 'completed',
        fields: {
          reversal_transaction_id: reversal.reversal.id,
          resolved_at: new Date().toISOString()
        }
      });

      await auditService.record(client, {
        actorType: confirmedBy ? 'user' : 'system',
        actorId: confirmedBy || null,
        eventType: 'fast_track.completed',
        resourceType: 'fast_track_reversal',
        resourceId: id,
        payload: { reversalId: reversal.reversal.id }
      });

      return { ftr: updated, reversal };
    });

  const findById = (id) => db.withClient((c) => model.findById(c, id));
  const list = (filters) =>
    db.withClient((c) =>
      model.list(c, {
        state: filters.state || null,
        victimParticipant: filters.victimParticipant || null,
        limit: filters.limit ?? 100
      })
    );

  return { invoke, confirmReversal, findById, list };
};
