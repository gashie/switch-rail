// ML scorer interface. Real production scorers (Phase 11+) implement the
// same shape (`score(features) -> 0..1`). The default scorer below is a
// hand-tuned logistic regression so the ML hook can be exercised end-to-end
// without a training pipeline.

import { config } from '../../../core/config.js';
import { defaultScorer } from './scorer-default.js';

const scorers = {
  default: defaultScorer
};

export const getScorer = (mode) => {
  const key = mode || config.fraudMlScorer || 'default';
  return scorers[key] || defaultScorer;
};

export const registerScorer = (key, scorer) => {
  scorers[key] = scorer;
};
