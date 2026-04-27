// Deterministic logistic-regression scorer with hand-tuned weights. The
// goal is not statistical fidelity — it's to prove the ML hook is wired
// end-to-end. A real Phase 11+ scorer drops in via the same interface.
//
// Behavior is deterministic per feature vector: same input always produces
// the same output. No timestamps, no randomness.

import { FEATURE_ORDER } from './feature-extractor.js';

// Weights aligned with FEATURE_ORDER. Positive = pushes toward fraud.
const WEIGHTS = Object.freeze({
  log10Amount: 0.35,
  isFirstTimeBeneficiary: 0.55,
  velocity1hCount: 0.18,
  velocity24hCount: 0.07,
  velocity24hDistinctBeneficiaries: 0.22,
  amountOverMaxObserved: 0.45,
  hourOfDayScore: -0.40, // higher hourOfDayScore = more typical, less fraud
  accountAgeYears: -0.55,
  beneficiaryAccountAgeYears: -0.30
});

const BIAS = -2.4;

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

export const defaultScorer = {
  name: 'default-logistic-v1',
  // features: object keyed by FEATURE_ORDER
  score: (features) => {
    let z = BIAS;
    for (const k of FEATURE_ORDER) {
      const v = Number(features[k] || 0);
      z += (WEIGHTS[k] || 0) * v;
    }
    const p = sigmoid(z);
    // Clamp to [0,1] explicitly to dodge floating-point edge cases.
    return Math.max(0, Math.min(1, p));
  }
};
