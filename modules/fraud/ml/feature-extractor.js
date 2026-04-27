// Pure feature extractor. Takes a RuleContext and emits the canonical
// numeric feature vector the default ML scorer expects. Order is locked
// per PHASE-6 — adding a feature requires bumping the model version.

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const extractFeatures = (ctx) => {
  const tx = ctx.transaction || {};
  const amount = Number(tx.amount_value || 0);
  const baseline = ctx.originator?.baseline || {};
  const maxObserved = Number(baseline.max_observed_minor || 0);
  const businessHoursPct = Number(baseline.business_hours_pct || 50);
  const hourOfDay = new Date().getUTCHours();
  // Score 1.0 if the current hour is "typical" for the account, 0 if night.
  const hourOfDayScore =
    hourOfDay >= 8 && hourOfDay < 18 ? clamp(businessHoursPct / 100, 0, 1) : 1 - clamp(businessHoursPct / 100, 0, 1);

  const accountAge = clamp(ctx.originator?.accountAgeDays ?? 0, 0, 365) / 365;
  const beneAge = clamp(ctx.beneficiary?.accountAgeDays ?? 0, 0, 365) / 365;

  return Object.freeze({
    log10Amount: amount > 0 ? Math.log10(amount) : 0,
    isFirstTimeBeneficiary: ctx.beneficiary?.isFirstTime ? 1 : 0,
    velocity1hCount: ctx.velocity?.last1h?.count ?? 0,
    velocity24hCount: ctx.velocity?.last24h?.count ?? 0,
    velocity24hDistinctBeneficiaries: ctx.velocity?.last24h?.distinctBeneficiaries ?? 0,
    amountOverMaxObserved:
      maxObserved > 0 ? clamp(amount / maxObserved, 0, 10) : 0,
    hourOfDayScore,
    accountAgeYears: accountAge,
    beneficiaryAccountAgeYears: beneAge
  });
};

// Stable feature order — used by the scorer to dot-product weights.
export const FEATURE_ORDER = Object.freeze([
  'log10Amount',
  'isFirstTimeBeneficiary',
  'velocity1hCount',
  'velocity24hCount',
  'velocity24hDistinctBeneficiaries',
  'amountOverMaxObserved',
  'hourOfDayScore',
  'accountAgeYears',
  'beneficiaryAccountAgeYears'
]);
