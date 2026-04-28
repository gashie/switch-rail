import { AppError } from '../../core/errors.js';
import { auditService } from '../audit/index.js';
import { participantsService } from '../participants/index.js';
import { directoryService } from '../directory/index.js';
import { envelopeService } from '../envelope/index.js';
import { createAuthorizationService } from '../authorization/index.js';
import { railOrchestrationService } from '../rail-orchestration/index.js';
import { creditLegService } from '../credit-leg/index.js';
import { transactionReceiptsService } from '../transaction-receipts/index.js';
import { ledgerService, ACCOUNT_TYPES, JOURNAL_REASONS, accountCodeFor } from '../ledger/index.js';
import { feesService } from '../fees/index.js';
import { networkGraphEdgesService } from '../network-graph/index.js';
// Importing settlement here is intentional — it registers the
// applyJournalToPositions hook on the ledger as a side effect of module
// load. The orchestrator is the load-bearing path for ledger writes, so
// this ensures the materialized position view is always in sync, including
// in tests that don't boot the monolith app.
import '../settlement/index.js';
import { CATEGORY } from '../../core/codes.js';
import {
  DEFAULT_DAILY_CAP_MINOR,
  DEFAULT_MONTHLY_CAP_MINOR
} from '../authorization/index.js';
import { isTerminal, STATES } from './states.js';

const SUCCESS_RESPONSE_CODE = 'ACSC';

// Operating date for the orchestrator's ledger posting. Today (UTC) until
// B5.5 lights up the operating-day model and stamps the column on the
// transaction itself.
const operatingDateFor = (tx) => {
  const ts = tx.authorized_at || tx.created_at || new Date();
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toISOString().slice(0, 10);
};

const postConfirmedJournal = async (client, tx) => {
  const currency = tx.amount_currency;
  await ledgerService._internal.ensureAccountOnClient(client, {
    accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
    ownerId: tx.originator_participant,
    currency
  });
  await ledgerService._internal.ensureAccountOnClient(client, {
    accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
    ownerId: tx.beneficiary_participant,
    currency
  });
  const amount = BigInt(tx.amount_value);
  const fee = BigInt(tx.fee_minor || 0);
  const totalDebit = amount + fee;
  const origAccount = accountCodeFor({
    accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
    ownerId: tx.originator_participant,
    currency
  });
  const beneAccount = accountCodeFor({
    accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
    ownerId: tx.beneficiary_participant,
    currency
  });
  const entries = [
    { accountCode: origAccount, side: 'DR', amount: String(totalDebit), currency },
    { accountCode: beneAccount, side: 'CR', amount: String(amount), currency }
  ];
  if (fee > 0n) {
    await ledgerService._internal.ensureAccountOnClient(client, {
      accountType: ACCOUNT_TYPES.RAIL_FEE_REVENUE,
      currency
    });
    entries.push({
      accountCode: accountCodeFor({ accountType: ACCOUNT_TYPES.RAIL_FEE_REVENUE, currency }),
      side: 'CR',
      amount: String(fee),
      currency
    });
  }
  return ledgerService.postJournal(client, {
    reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
    referenceType: 'transaction',
    referenceId: tx.id,
    operatingDate: operatingDateFor(tx),
    entries,
    metadata: {
      endToEndId: tx.end_to_end_id,
      railClass: tx.rail_class,
      feeMinor: String(fee)
    }
  });
};

const toBigIntCap = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
};

const fetchAuthContext = async (client, { transaction, originatorParticipant, envelope }) => {
  const [originatorAccount, beneficiaryAccountRaw] = await Promise.all([
    directoryService
      .findByAccount({
        participantCode: transaction.originator_participant,
        accountNumber: transaction.originator_account
      })
      .catch(() => null),
    directoryService
      .findByAccount({
        participantCode: transaction.beneficiary_participant,
        accountNumber: transaction.beneficiary_account
      })
      .catch(() => null)
  ]);

  // Phase 9 — for XB_CRDT_TRF envelopes, the beneficiary account lives on
  // the foreign rail's books, not in our directory. Synthesize an "active"
  // placeholder so the standard account-status auth check doesn't fire.
  // The foreign rail's own contract enforces beneficiary validity (and our
  // foreign-rail simulator + travel-rule checks cover the auth surface).
  const beneficiaryAccount = (envelope?.msgType === 'XB_CRDT_TRF' && !beneficiaryAccountRaw)
    ? {
        id: null,
        participant_code: transaction.beneficiary_participant,
        account_number: transaction.beneficiary_account,
        account_type: 'BANK_ACCOUNT',
        status: 'active',
        synthetic: true
      }
    : beneficiaryAccountRaw;

  const recentMatchingE2E = await transactionsServiceInternal(client).countRecentByOriginatorAndE2E({
    participantCode: transaction.originator_participant,
    endToEndId: transaction.end_to_end_id,
    excludeId: transaction.id
  });

  const dailyVolumeMinor = await transactionsServiceInternal(client).sumVolumeForOriginator({
    participantCode: transaction.originator_participant,
    withinIntervalSeconds: 86_400
  });
  const monthlyVolumeMinor = await transactionsServiceInternal(client).sumVolumeForOriginator({
    participantCode: transaction.originator_participant,
    withinIntervalSeconds: 30 * 86_400
  });

  const meta = originatorParticipant?.metadata || {};
  const dailyCapMinor = toBigIntCap(meta.dailyCapMinor, DEFAULT_DAILY_CAP_MINOR);
  const monthlyCapMinor = toBigIntCap(meta.monthlyCapMinor, DEFAULT_MONTHLY_CAP_MINOR);

  return {
    transaction,
    client,
    envelope,
    originatorAccount,
    beneficiaryAccount,
    recentMatchingE2E,
    dailyVolumeMinor,
    monthlyVolumeMinor,
    dailyCapMinor,
    monthlyCapMinor
  };
};

// Captured at module load — orchestrator pulls the same singleton service
// the route layer uses, so transitions show up in the same audit chain.
let _txService = null;
const transactionsServiceInternal = (client) => {
  if (!_txService) {
    throw new AppError(
      'INTERNAL',
      'orchestrator was used before createOrchestrator() bound the transactions service',
      500
    );
  }
  // Rebind helpers to a specific client so callers don't have to repeat it.
  return {
    countRecentByOriginatorAndE2E: (args) =>
      _txService._internal.countRecentByOriginatorAndE2E(client, args),
    sumVolumeForOriginator: (args) =>
      _txService._internal.sumVolumeForOriginator(client, args),
    transition: (txOrId, to, opts) =>
      _txService._internal.transitionOnClient(client, txOrId, to, opts),
    ingest: (envelope) => _txService._internal.ingestOnClient(client, envelope)
  };
};

const validateRouting = async (envelope) => {
  const beneficiary = await participantsService
    .getByCode(envelope.beneficiary.participantCode)
    .catch(() => null);
  if (!beneficiary) {
    return {
      ok: false,
      code: 'BENEFICIARY_ACCOUNT_NOT_FOUND',
      message: `participant ${envelope.beneficiary.participantCode} not registered`
    };
  }
  if (beneficiary.status !== 'active') {
    return {
      ok: false,
      code: 'BENEFICIARY_ACCOUNT_BLOCKED',
      message: `beneficiary participant is ${beneficiary.status}`
    };
  }
  return { ok: true, beneficiary };
};

// Phase 9 cross-border injection point. Wired by modules/crossborder-tx
// at boot to avoid an import cycle. When unset, XB envelopes fall through
// to the standard credit-leg path (which will fail validation because XB
// envelopes don't carry a real domestic beneficiary participant).
let _xbCoordinator = null;
export const registerCrossborderCoordinator = (coordinator) => {
  _xbCoordinator = coordinator;
};

export const createOrchestrator = ({ db, transactionsService }) => {
  _txService = transactionsService;
  const authorizationService = createAuthorizationService();

  const finalizeWithError = async (client, transaction, code, message) =>
    transactionsServiceInternal(client).transition(transaction, STATES.REJECTED, {
      reasonCode: code,
      reasonMessage: message,
      responseCode: 'RJCT',
      occurredBy: 'system',
      payload: { stage: 'orchestrator' }
    });

  const process = async (envelope) =>
    db.withTransaction(async (client) => {
      // 1. Persist the envelope idempotently. Use the same client so the
      // ingest is part of the orchestrator's outermost transaction; this
      // way a downstream throw rolls the whole flow back atomically.
      const ingest = await envelopeService.ingest(envelope, client);
      // 2. Create (or fetch existing) transaction.
      let tx = await transactionsServiceInternal(client).ingest(ingest.envelope);
      if (isTerminal(tx.state)) {
        return { transaction: tx, deduped: true };
      }

      try {
        // 3. Authorization
        const originatorParticipant = await participantsService
          .getByCode(tx.originator_participant)
          .catch(() => null);
        const ctx = await fetchAuthContext(client, { transaction: tx, originatorParticipant, envelope });
        const authResult = await authorizationService.authorize(ctx);
        if (!authResult.ok) {
          tx = await finalizeWithError(client, tx, authResult.code, authResult.message);
          return { transaction: tx, deduped: false };
        }
        tx = await transactionsServiceInternal(client).transition(tx, STATES.AUTHORIZED, {
          occurredBy: 'system',
          payload: { authResult }
        });

        // 3a. Stamp the fee at AUTHORIZED. Defaults to 0 if no schedule
        // matches; the journal will then be 2-leg without a fee leg.
        const feeResult = await feesService.calculateFee({
          railClass: tx.rail_class,
          currency: tx.amount_currency,
          amountMinor: String(tx.amount_value),
          client
        });
        if (feeResult.feeMinor !== '0' || feeResult.scheduleId) {
          await _txService._internal.setFee(client, tx.id, feeResult.feeMinor, feeResult.scheduleId);
          tx = await _txService.findById(tx.id, client);
        }

        // 4. Routing — beneficiary participant exists + active
        const route = await validateRouting(envelope);
        if (!route.ok) {
          tx = await finalizeWithError(client, tx, route.code, route.message);
          return { transaction: tx, deduped: false };
        }
        tx = await transactionsServiceInternal(client).transition(tx, STATES.ROUTED, {
          occurredBy: 'system',
          payload: { beneficiaryParticipantCode: route.beneficiary.code }
        });

        // 5. Rail-class orchestration
        await railOrchestrationService.orchestrate({
          client,
          transactionId: tx.id,
          envelope,
          originatorParticipant,
          beneficiaryParticipant: route.beneficiary
        });
        tx = await _txService.findById(tx.id, client);

        // 5a. Phase 9 cross-border branch. When the envelope is XB_CRDT_TRF,
        // delegate to the cross-border coordinator instead of running the
        // standard credit-leg. The coordinator commits both ledger legs in
        // this same withTransaction; the recovery worker then drives the
        // foreign-rail handoff to CONFIRMED/REJECTED post-commit.
        if (envelope.msgType === 'XB_CRDT_TRF' && _xbCoordinator) {
          tx = await transactionsServiceInternal(client).transition(tx, STATES.CREDIT_LEG_PENDING, {
            occurredBy: 'system',
            payload: { branch: 'crossborder' }
          });
          let xbResult;
          try {
            xbResult = await _xbCoordinator.coordinateOnClient(client, {
              envelope, transaction: tx
            });
          } catch (xbError) {
            // Pre-commit XB validation errors (FX expired, slippage,
            // travel-rule sanctions hit) should reject the parent tx with
            // a structured reason rather than bubble up as RAIL_INTERNAL_ERROR.
            const code = xbError?.code === 'CONFLICT' || xbError?.code === 'NOT_FOUND' || xbError?.code === 'VALIDATION_FAILED'
              ? `XB_${(xbError?.message || 'INVALID').split(':')[0].trim().replace(/[^A-Z_0-9]/gi, '_').toUpperCase().slice(0, 60)}`
              : 'XB_REJECTED';
            tx = await finalizeWithError(client, tx, code, xbError?.message || String(xbError));
            return { transaction: tx, deduped: false, crossborderError: { code, message: xbError?.message } };
          }
          // Parent tx stays in CREDIT_LEG_PENDING; recovery worker promotes
          // to CONFIRMED on foreign ACCEPTED, REJECTED on foreign REJECTED.
          return { transaction: tx, deduped: false, crossborder: xbResult };
        }

        // 6. Credit-leg call. We move into CREDIT_LEG_PENDING first so the
        // outbound HTTP call is observable in the status history even if it
        // takes the full timeout window.
        tx = await transactionsServiceInternal(client).transition(tx, STATES.CREDIT_LEG_PENDING, {
          occurredBy: 'system'
        });
        const cl = await creditLegService.run({ transaction: tx, envelope });
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'transaction.credit_leg.completed',
          resourceType: 'transaction',
          resourceId: tx.id,
          payload: {
            category: cl.category,
            reasonCode: cl.reasonCode,
            durationMs: cl.durationMs,
            requestId: cl.requestId
          }
        });

        // 7. Atomic outcome
        if (cl.category === CATEGORY.TERMINAL_SUCCESS) {
          tx = await transactionsServiceInternal(client).transition(tx, STATES.CONFIRMED, {
            responseCode: SUCCESS_RESPONSE_CODE,
            reasonCode: 'SUCCESS',
            occurredBy: 'system',
            payload: { creditedAt: cl.raw?.data?.creditedAt }
          });
          // Order locked per PHASE-5: state → ledger → receipts. All in the
          // same withTransaction so a ledger or receipt failure rolls back
          // the CONFIRMED transition with it.
          const ledger = await postConfirmedJournal(client, tx);
          const receipts = await transactionReceiptsService.issueReceipts(client, tx);
          // Network-graph edge write — async-flavored but participates in
          // the same transaction so it commits atomically. The scanner
          // worker reads these edges out-of-band on its own schedule.
          await networkGraphEdgesService.recordEdgeForTransaction(tx, { client });
          return { transaction: tx, deduped: false, creditLeg: cl, ledger, receipts };
        }
        if (cl.category === CATEGORY.TERMINAL_FAIL) {
          tx = await finalizeWithError(client, tx, cl.reasonCode, cl.raw?.error?.message || cl.reasonCode);
          return { transaction: tx, deduped: false, creditLeg: cl };
        }
        // AMBIGUOUS / RETRYABLE_FAIL → recovery takes over
        tx = await transactionsServiceInternal(client).transition(
          tx,
          STATES.PENDING_RECONCILIATION,
          {
            reasonCode: cl.reasonCode,
            reasonMessage: cl.raw?.error?.message || `credit-leg ${cl.category}`,
            occurredBy: 'system',
            payload: { category: cl.category, durationMs: cl.durationMs }
          }
        );
        return { transaction: tx, deduped: false, creditLeg: cl };
      } catch (e) {
        // Catch-all: never leave a transaction in a non-terminal state when
        // an unexpected error fires inside the orchestrator. The state
        // machine forbids re-entering REJECTED from a terminal state, so
        // refresh first and only force-reject if still non-terminal.
        const fresh = await _txService.findById(tx.id, client);
        if (fresh && !isTerminal(fresh.state)) {
          await transactionsServiceInternal(client).transition(fresh, STATES.REJECTED, {
            reasonCode: 'RAIL_INTERNAL_ERROR',
            reasonMessage: e?.message || String(e),
            responseCode: 'RJCT',
            occurredBy: 'system',
            payload: { internalError: true }
          });
        }
        throw e;
      }
    });

  return { process };
};
