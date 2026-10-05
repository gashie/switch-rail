// In-line fraud engine: takes a built RuleContext, runs every active rule
// for the originator participant, computes composite verdict + score,
// optionally calls the ML scorer, persists a signal row, and returns the
// result.
//
// Function-signature rule enforcement: evaluate() takes a built context
// only — no raw db handles or arbitrary contexts. Composing the context
// is the responsibility of the rule-context-builder; the engine assumes
// it's been built correctly.

import { runnerFor } from './rule-runners/index.js';
import { extractFeatures } from './ml/feature-extractor.js';
import { getScorer } from './ml/scorer.js';
import { VERDICTS, SOURCES, EVALUATED_BY } from './codes.js';

// Pure verdict math, isolated for unit tests.
export const computeComposite = ({ activeRules, context }) => {
  let composite = 0;
  const hits = [];
  for (const rule of activeRules) {
    const runner = runnerFor(rule.rule_code);
    if (!runner) continue;
    let result;
    try {
      result = runner(context, rule.parameters || {});
    } catch (e) {
      // A buggy runner must not break the pipeline. Treat as no-hit and
      // continue.
      result = { hit: false, error: e.message };
    }
    if (result.hit) {
      const weight = rule.weight ?? 50;
      const contribution = (result.score ?? 0) * (weight / 100);
      composite += contribution;
      hits.push({
        ruleCode: rule.rule_code,
        score: result.score ?? 0,
        weight,
        contribution: Math.round(contribution * 100) / 100,
        reasons: result.reasons || []
      });
    }
  }
  composite = Math.min(100, Math.round(composite));
  // Pack thresholds: if the rules came from one pack we use its thresholds,
  // otherwise (multi-pack) use the strictest (lowest) block_threshold.
  let blockThreshold = 80;
  let reviewThreshold = 50;
  if (activeRules.length > 0) {
    blockThreshold = Math.min(...activeRules.map((r) => r.block_threshold ?? 80));
    reviewThreshold = Math.min(...activeRules.map((r) => r.review_threshold ?? 50));
  }
  const verdict =
    composite >= blockThreshold
      ? VERDICTS.BLOCK
      : composite >= reviewThreshold
        ? VERDICTS.REVIEW
        : VERDICTS.PASS;
  return { composite, verdict, hits, blockThreshold, reviewThreshold };
};

export const createFraudEngine = ({ rulesService, signalsService, mlMode }) => {
  const evaluate = async (context, options = {}) => {
    if (!context?.transaction) {
      throw new Error('fraudEngine.evaluate requires a built RuleContext');
    }
    const t0 = Date.now();
    const participantCode = context.transaction.originator_participant;
    const activeRules = await rulesService.listActiveRulesForParticipant(participantCode);
    const composite = computeComposite({ activeRules, context });

    // ML scoring runs alongside rules. The default scorer is in the budget;
    // a remote scorer (Phase 11+) may be moved to async.
    let mlScore = null;
    let mlFeatures = null;
    if (options.skipMl !== true) {
      mlFeatures = extractFeatures(context);
      const scorer = getScorer(mlMode);
      mlScore = scorer.score(mlFeatures);
    }

    const result = {
      ...composite,
      mlScore,
      mlFeatures,
      durationMs: Date.now() - t0
    };

    // Persist the signal. Caller may pass `client` to participate in their
    // transaction (orchestrator does); otherwise we open our own.
    if (options.persistAs !== false) {
      const signal = {
        transactionId: context.transaction.id,
        source: SOURCES.RULES,
        compositeVerdict: composite.verdict,
        compositeScore: composite.composite,
        ruleHits: composite.hits,
        mlScore,
        mlFeatures,
        evaluatedBy: options.evaluatedBy || EVALUATED_BY.IN_LINE
      };
      if (options.client && typeof options.client.query === 'function') {
        await signalsService.record(options.client, signal);
      } else {
        await signalsService.record(signal);
      }
    }

    return result;
  };

  return { evaluate };
};
