// PvP coordinator. Called from the orchestrator when it sees an XB_CRDT_TRF
// envelope. Both ledger legs commit in the parent withTransaction; the
// foreign-rail call happens after the local commit, with the recovery worker
// covering ambiguous outcomes.
//
// The coordinator runs *inside* the orchestrator's withTransaction client.
// On success it returns the post-commit state (FOREIGN_INSTRUCTING). On any
// pre-commit failure (FX expired, slippage, travel-rule sanctions hit), it
// throws — orchestrator rolls back and finalizes the transaction as REJECTED.

import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { foreignRailsService } from '../crossborder-rails/index.js';
import { crossborderFxService } from '../crossborder-fx/index.js';
import { STATES } from './states.js';
import { postLeg1, postLeg2 } from './leg-runner.js';

let _travelRuleService = null;
export const setTravelRuleService = (svc) => { _travelRuleService = svc; };

export const createCoordinator = ({ db, model }) => {
  // Called from inside orchestrator's withTransaction(client, ...).
  // Returns { id, state, transactionId } on success.
  const coordinateOnClient = async (client, { envelope, transaction }) => {
    const xb = envelope.crossBorder;
    if (!xb) {
      throw new AppError('VALIDATION_FAILED', 'crossBorder field required for XB_CRDT_TRF', 400);
    }
    const { foreignRailCode, fx, travelRule, settlementAssetType } = xb;

    // 1. Foreign rail must exist + be active.
    const rail = await foreignRailsService.findByCode(foreignRailCode);
    if (!rail) {
      throw new AppError('NOT_FOUND', `foreign rail ${foreignRailCode} not registered`, 404);
    }
    if (!rail.active) {
      throw new AppError('CONFLICT', `foreign rail ${foreignRailCode} is not active`, 409);
    }

    // 2. Verify FX quote (slippage + expiration) and consume it on this tx.
    await crossborderFxService.verifyAndConsumeOnClient(client, {
      quoteId: fx.quoteId,
      transactionId: transaction.id
    });

    // 3. Travel rule enforcement (Phase 9 B9.5). When the service is wired,
    // it persists the record + runs sanctions checks. If it isn't wired
    // (B9.4 ships before B9.5 in test fixtures), we audit-only and proceed.
    if (_travelRuleService) {
      await _travelRuleService.enforceOnClient(client, {
        envelope,
        crossborderTxId: null, // crossborder_transactions row is created below
        direction: 'OUTBOUND'
      });
    }

    // 4. Post both ledger legs. They commit together with this client.
    const leg1JournalId = await postLeg1(client, {
      transaction,
      payCurrency: fx.payCurrency,
      payAmountMinor: fx.payAmount
    });
    const leg2JournalId = await postLeg2(client, {
      transaction,
      foreignRailCode,
      receiveCurrency: fx.receiveCurrency,
      receiveAmountMinor: fx.receiveAmount
    });

    // 5. Persist the crossborder_transactions row.
    const id = uuidv7();
    const inserted = await model.insert(client, {
      id,
      transactionId: transaction.id,
      foreignRailCode,
      fxQuoteId: fx.quoteId,
      payCurrency: fx.payCurrency,
      receiveCurrency: fx.receiveCurrency,
      payAmountMinor: String(fx.payAmount),
      receiveAmountMinor: String(fx.receiveAmount),
      travelRulePayload: travelRule,
      settlementAssetType: settlementAssetType || 'LOCAL_CURRENCY_NET',
      leg1JournalId,
      leg2JournalId,
      state: STATES.FOREIGN_INSTRUCTING,
      metadata: {
        envelopeId: envelope.envelopeId,
        railCode: foreignRailCode,
        railType: rail.rail_type,
        settlementModel: rail.settlement_model,
        // Captured for the recovery worker so it can replay the foreign-rail
        // instruction without re-deriving from the envelope.
        originatorParticipant: transaction.originator_participant,
        beneficiaryParticipant: envelope.beneficiary.participantCode,
        beneficiaryAccount: envelope.beneficiary.accountId,
        beneficiaryName: envelope.beneficiary.name
      }
    });
    if (!inserted) {
      // ON CONFLICT (transaction_id) — should not happen because the parent
      // transaction is uniquely identified.
      throw new AppError('CONFLICT', `crossborder tx for transaction ${transaction.id} already exists`, 409);
    }

    await auditService.record(client, {
      actorType: 'system',
      eventType: 'crossborder.legs_committed',
      resourceType: 'crossborder_tx',
      resourceId: id,
      payload: {
        transactionId: transaction.id,
        foreignRailCode,
        leg1JournalId,
        leg2JournalId,
        payCurrency: fx.payCurrency,
        receiveCurrency: fx.receiveCurrency,
        payAmount: String(fx.payAmount),
        receiveAmount: String(fx.receiveAmount)
      }
    });

    return { id, state: STATES.FOREIGN_INSTRUCTING, leg1JournalId, leg2JournalId };
  };

  // Public form when called outside an existing transaction (rare; tests use
  // it). Wraps coordinateOnClient in withTransaction.
  const coordinate = ({ envelope, transaction }) =>
    db.withTransaction((client) => coordinateOnClient(client, { envelope, transaction }));

  return { coordinate, coordinateOnClient };
};
