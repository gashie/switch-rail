import { railClass as domesticInstant } from './classes/domestic-instant.js';
import { railClass as mobileMoneyInterop } from './classes/mobile-money-interop.js';
import { railClass as foreign } from './classes/foreign.js';
import { railClass as domesticBatch } from './classes/domestic-batch.js';

// Sorted by priority ascending — lowest priority number wins.
export const REGISTRY = Object.freeze(
  [domesticInstant, mobileMoneyInterop, foreign, domesticBatch]
    .slice()
    .sort((a, b) => a.priority - b.priority)
);

export const byName = (name) => REGISTRY.find((c) => c.name === name) || null;

export const chooseClassFor = ({ originator, beneficiary, envelope }) => {
  for (const cls of REGISTRY) {
    if (cls.classify({ originator, beneficiary, envelope })) return cls;
  }
  return null;
};
