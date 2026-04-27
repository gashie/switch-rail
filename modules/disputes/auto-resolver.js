// Auto-resolver registry. Each reason code in SLA_WINDOWS that has a non-null
// `autoResolvable` key maps to a runner here. B7.2 ships an empty registry —
// so every accepted case routes to EVIDENCE_PENDING. B7.4 fills in the
// runners and the orchestrating apply-step.
//
// Runner contract:
//   runner({ caseRow, transaction, client, deps }) -> Promise<
//     | { resolvable: false }
//     | { resolvable: true, outcome, rationaleCode, outcomeAmountMinor? }
//   >
//
// `deps` is a bag of services the runner may need (reconciliation, cop history,
// fast-track, transactions). Wiring lives in routes.js so the registry stays
// pure for testing.

const RUNNERS = new Map();

export const registerRunner = (key, fn) => {
  if (typeof fn !== 'function') {
    throw new Error(`autoResolver: runner for ${key} must be a function`);
  }
  RUNNERS.set(key, fn);
};

export const runnerFor = (key) => RUNNERS.get(key) || null;

export const hasRunnerFor = (key) => RUNNERS.has(key);

// Test/reset hook — used by unit tests to clear and re-seed the registry.
export const _resetRunners = () => RUNNERS.clear();

// Convenience for tests + production wire-up: register all four B7.4 runners
// in one call. Tests that need real runners after _resetRunners() should
// invoke this; routes.js does it on first import.
export const registerDefaultRunners = async () => {
  const [{ rFraud }, { rDuplicate }, { rTechnical }, { rWrongBeneficiary }] = await Promise.all([
    import('./auto-resolver-rules/r-fraud.js'),
    import('./auto-resolver-rules/r-duplicate.js'),
    import('./auto-resolver-rules/r-technical.js'),
    import('./auto-resolver-rules/r-wrong-beneficiary.js')
  ]);
  registerRunner('r-fraud', rFraud);
  registerRunner('r-duplicate', rDuplicate);
  registerRunner('r-technical', rTechnical);
  registerRunner('r-wrong-beneficiary', rWrongBeneficiary);
};
