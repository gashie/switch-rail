import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { OUTCOMES } from './codes.js';
import { STATES } from './states.js';
import { stateForOutcome, validateManualDecision } from './manual-workflow.js';

export const createDecisionService = ({
  db,
  decisionModel,
  casesModel,
  evidenceModel,
  disputesService
}) => {
  // Manual decision capture. Transitions ADJUDICATING -> {UPHELD, DENIED,
  // PARTIAL_UPHELD}; the actual money movement is gated by B7.5's
  // confirm-settlement step (maker-checker), per the conservative rule.
  const decideManually = async ({
    caseNumber,
    outcome,
    rationaleCode,
    rationaleNotes,
    outcomeAmountMinor,
    decidedByUser
  }) => {
    return db.withTransaction(async (client) => {
      const c = await casesModel.findByCaseNumber(client, caseNumber);
      if (!c) throw new AppError('NOT_FOUND', `case ${caseNumber} not found`, 404);
      if (c.state !== STATES.ADJUDICATING) {
        throw new AppError(
          'CONFLICT',
          `decision requires state ADJUDICATING, got ${c.state}`,
          409
        );
      }

      const validationError = validateManualDecision({
        outcome,
        rationaleCode,
        outcomeAmountMinor,
        caseAmountMinor: String(c.amount_minor)
      });
      if (validationError) {
        throw new AppError('VALIDATION_FAILED', validationError, 400);
      }

      // Snapshot evidence considered at decision time.
      const evidence = await evidenceModel.listForCase(client, { caseId: c.id });
      const evidenceSnapshot = evidence.map((e) => ({
        id: e.id,
        side: e.side,
        evidenceType: e.evidence_type,
        contentSha256: e.content_sha256
      }));

      const decisionId = uuidv7();
      const inserted = await decisionModel.insert(client, {
        id: decisionId,
        caseId: c.id,
        decisionType: 'MANUAL',
        outcome,
        outcomeAmountMinor: outcomeAmountMinor ?? null,
        rationaleCode,
        rationaleNotes,
        decidedByUser,
        evidenceConsidered: evidenceSnapshot
      });
      if (!inserted) {
        // ON CONFLICT (case_id) DO NOTHING returned no row — there's already a decision.
        const existing = await decisionModel.findByCaseId(client, c.id);
        throw new AppError(
          'CONFLICT',
          `case ${caseNumber} already has decision ${existing?.id}`,
          409
        );
      }

      const toState = stateForOutcome(outcome);
      const updated = await disputesService.transition(client, c.id, toState, {
        reason: rationaleCode,
        payload: {
          fields: {
            outcome,
            outcome_amount_minor: outcomeAmountMinor ?? null,
            outcome_notes: rationaleNotes ?? null
          },
          decisionId,
          rationaleCode
        },
        occurredBy: decidedByUser ? `user:${decidedByUser}` : 'operator'
      });

      await auditService.record(client, {
        actorType: 'user',
        actorId: decidedByUser || null,
        eventType: 'dispute.decided',
        resourceType: 'dispute_case',
        resourceId: c.id,
        payload: { decisionId, outcome, rationaleCode, decisionType: 'MANUAL' }
      });

      // Conservative rule: write reversal_needed audit signaling that money
      // movement is required but pending operator confirmation. The actual
      // ledger release is in B7.5 confirm-settlement.
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'dispute.reversal_needed',
        resourceType: 'dispute_case',
        resourceId: c.id,
        payload: { decisionId, outcome, decisionType: 'MANUAL', awaiting: 'confirm_settlement' }
      });

      return { case: updated, decision: inserted };
    });
  };

  // Apply auto-resolution: caller has already determined the case is
  // resolvable. This persists the decision row + transitions ACCEPTED ->
  // AUTO_RESOLVED. Settlement-service handles AUTO_RESOLVED -> SETTLED.
  const applyAutoResolution = async ({
    client,
    caseRow,
    runnerKey,
    resolution
  }) => {
    if (!resolution?.resolvable) {
      throw new Error('applyAutoResolution called with non-resolvable resolution');
    }
    const { outcome, rationaleCode, outcomeAmountMinor, notes } = resolution;
    if (!Object.values(OUTCOMES).includes(outcome)) {
      throw new Error(`auto-resolver returned unknown outcome ${outcome}`);
    }

    const decisionId = uuidv7();
    const inserted = await decisionModel.insert(client, {
      id: decisionId,
      caseId: caseRow.id,
      decisionType: 'AUTO',
      outcome,
      outcomeAmountMinor: outcomeAmountMinor ?? null,
      rationaleCode,
      rationaleNotes: notes || null,
      decidedByUser: null,
      evidenceConsidered: { runnerKey, autoApplied: true }
    });
    if (!inserted) {
      throw new AppError('CONFLICT', `case ${caseRow.id} already has decision`, 409);
    }
    return inserted;
  };

  const findByCase = (caseNumber) =>
    db.withClient(async (client) => {
      const c = await casesModel.findByCaseNumber(client, caseNumber);
      if (!c) return null;
      return decisionModel.findByCaseId(client, c.id);
    });

  return {
    decideManually,
    applyAutoResolution,
    findByCase
  };
};
