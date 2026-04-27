import {
  fraudRuleContextBuilder,
  fraudRulesService,
  fraudSignalsService,
  createFraudEngine,
  VERDICTS
} from '../../fraud/index.js';

// Singleton engine — same rules-service and signals-service that the
// fraud module's HTTP routes use, so the audit chain is consistent.
const engine = createFraudEngine({
  rulesService: fraudRulesService,
  signalsService: fraudSignalsService
});

/**
 * Real Phase 6 fraud check. Builds a RuleContext for the transaction,
 * runs the engine, persists a signal, and returns:
 *  - pass=true with score in metadata for PASS / REVIEW
 *  - pass=false with code FRAUD_BLOCK on BLOCK
 *
 * REVIEW does NOT block the wire — operators handle review-flagged tx
 * reactively via the Phase 10 ops console. The signal is recorded so the
 * review queue is populated.
 */
export const fraud = async ({ transaction, client, skipFraudPersistence }) => {
  if (!transaction) return { pass: true, score: 0 };
  const context = await fraudRuleContextBuilder.buildContext({
    transaction,
    client
  });
  // Unit tests pass synthetic transactions that aren't in the DB; they set
  // skipFraudPersistence to bypass the FK on transaction_fraud_signals.
  // The orchestrator (which always has a persisted transaction) leaves it
  // unset so signals are recorded.
  const result = await engine.evaluate(context, { client, persistAs: skipFraudPersistence ? false : true });
  if (result.verdict === VERDICTS.BLOCK) {
    const top = result.hits[0]?.reasons?.[0]?.message || 'fraud rules composite verdict BLOCK';
    return {
      pass: false,
      code: 'FRAUD_BLOCK',
      message: `fraud BLOCK at score ${result.composite}: ${top}`,
      score: result.composite,
      hits: result.hits
    };
  }
  return {
    pass: true,
    verdict: result.verdict,
    score: result.composite,
    mlScore: result.mlScore,
    hits: result.hits
  };
};
