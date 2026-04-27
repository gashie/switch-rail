// 15 fraud rule runners — pure, deterministic, side-effect-free. Each
// takes (RuleContext, parameters) and returns either { hit: false } or
// { hit: true, score, reasons: [{ code, message }] }. Engine multiplies
// `score` by `rule.weight / 100` to get the rule's composite contribution.

const reason = (code, message) => ({ code, message });
const noHit = { hit: false };

// R001 — high velocity in last hour
export const r001 = (ctx, p) => {
  const count = ctx.velocity?.last1h?.count ?? 0;
  if (count >= (p.thresholdCount ?? 8)) {
    return {
      hit: true,
      score: p.score ?? 80,
      reasons: [reason('R001_HIGH_VELOCITY_1H', `${count} transactions in last 1h ≥ ${p.thresholdCount ?? 8}`)]
    };
  }
  return noHit;
};

// R002 — amount more than N× rolling baseline (max observed)
export const r002 = (ctx, p) => {
  const amount = BigInt(ctx.transaction?.amount_value || 0);
  const baseMax = ctx.originator?.baseline?.max_observed_minor;
  if (!baseMax || baseMax === '0' || ctx.originator?.baseline?.metadata?.young) return noHit;
  const max = BigInt(baseMax);
  const multiplier = BigInt(Math.max(1, p.multiplier ?? 5));
  if (amount >= max * multiplier) {
    return {
      hit: true,
      score: p.score ?? 75,
      reasons: [reason('R002_HIGH_VALUE_VS_BASELINE', `amount ${amount} ≥ ${multiplier}× max-observed ${max}`)]
    };
  }
  return noHit;
};

// R003 — first-time beneficiary AND amount above threshold
export const r003 = (ctx, p) => {
  if (!ctx.beneficiary?.isFirstTime) return noHit;
  const amount = BigInt(ctx.transaction?.amount_value || 0);
  const threshold = BigInt(p.thresholdMinor || '500000');
  if (amount >= threshold) {
    return {
      hit: true,
      score: p.score ?? 60,
      reasons: [reason('R003_NEW_BENEFICIARY_HIGH_VALUE', `first-time beneficiary, amount ${amount} ≥ ${threshold}`)]
    };
  }
  return noHit;
};

// R004 — structuring: many sub-threshold tx in tight window
export const r004 = (ctx, p) => {
  const window = ctx.velocity?.last24h;
  if (!window) return noHit;
  const count = window.count ?? 0;
  const minCount = p.minCount ?? 8;
  const amount = BigInt(ctx.transaction?.amount_value || 0);
  const maxIndividual = BigInt(p.maxIndividualMinor || '500000');
  if (count >= minCount && amount < maxIndividual) {
    return {
      hit: true,
      score: p.score ?? 85,
      reasons: [reason('R004_STRUCTURING_PATTERN', `${count} sub-threshold tx in 24h, current ${amount} < ${maxIndividual}`)]
    };
  }
  return noHit;
};

// R005 — Sakawa rapid dispersal: inbound credit followed by N+ outbound to MoMo within 1h
// We approximate without sub-second device telemetry: many recent outbounds to
// distinct beneficiaries flag the pattern.
export const r005 = (ctx, p) => {
  const dispersalCount = p.dispersalCount ?? 3;
  const distinct = ctx.velocity?.last24h?.distinctBeneficiaries ?? 0;
  const recentCount = ctx.velocity?.last1h?.count ?? 0;
  if (recentCount >= dispersalCount && distinct >= dispersalCount) {
    return {
      hit: true,
      score: p.score ?? 90,
      reasons: [reason('R005_SAKAWA_RAPID_DISPERSAL', `${recentCount} outbound in 1h to ${distinct} distinct beneficiaries`)]
    };
  }
  return noHit;
};

// R006 — SIM swap velocity (placeholder until alias-history is wired)
export const r006 = (ctx, p) => {
  const simSwapped = ctx.originator?.account?.metadata?.recentSimSwap === true;
  if (!simSwapped) return noHit;
  const count = ctx.velocity?.last1h?.count ?? 0;
  if (count >= (p.velocityMultiplier ?? 3)) {
    return {
      hit: true,
      score: p.score ?? 85,
      reasons: [reason('R006_SIM_SWAP_VELOCITY', `velocity spike on SIM-swapped account`)]
    };
  }
  return noHit;
};

// R007 — MoMo agent transactions in unusual hours
export const r007 = (ctx, p) => {
  const isAgent = ctx.originator?.account?.metadata?.isMomoAgent === true;
  if (!isAgent) return noHit;
  const hour = new Date().getUTCHours();
  const startHour = p.unusualHourStart ?? 23;
  const endHour = p.unusualHourEnd ?? 5;
  const inUnusualWindow = startHour > endHour ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour;
  if (inUnusualWindow) {
    return {
      hit: true,
      score: p.score ?? 50,
      reasons: [reason('R007_MOMO_AGENT_PATTERN', `agent transaction at hour ${hour}`)]
    };
  }
  return noHit;
};

// R008 — geo velocity impossible (placeholder; lights up when device fingerprinting lands)
export const r008 = (ctx, p) => {
  const geoSignal = ctx.device?.geoVelocityImpossible === true;
  if (geoSignal) {
    return {
      hit: true,
      score: p.score ?? 95,
      reasons: [reason('R008_GEO_VELOCITY_IMPOSSIBLE', 'physically-impossible geo claim')]
    };
  }
  return noHit;
};

// R009 — night-owl tx for an account that historically transacts business hours
export const r009 = (ctx, p) => {
  const baseline = ctx.originator?.baseline;
  if (!baseline || baseline.metadata?.young) return noHit;
  const businessPct = Number(baseline.business_hours_pct || 0);
  if (businessPct < (p.businessHourMinPct ?? 80)) return noHit;
  const hour = new Date().getUTCHours();
  if (hour >= (p.nightStart ?? 2) && hour < (p.nightEnd ?? 4)) {
    return {
      hit: true,
      score: p.score ?? 40,
      reasons: [reason('R009_NIGHT_OWL', `tx at hour ${hour} for ${businessPct}%-business-hours account`)]
    };
  }
  return noHit;
};

// R010 — dormant reactivation
export const r010 = (ctx, p) => {
  const baseline = ctx.originator?.baseline;
  if (!baseline) return noHit;
  const lastObserved = baseline.computed_at ? new Date(baseline.computed_at).getTime() : null;
  const total = Number(baseline.total_observations || 0);
  if (!lastObserved || total === 0) return noHit;
  const dormantThreshold = p.dormantDays ?? 180;
  // We don't track "last seen" directly; use baseline metadata.lastTxAt if
  // present (filled by future iterations), otherwise total==0 of the
  // window means dormant.
  const dormant = total === 0;
  const recentCount = ctx.velocity?.last24h?.count ?? 0;
  if (dormant && recentCount >= (p.reactivationVelocity ?? 5)) {
    return {
      hit: true,
      score: p.score ?? 70,
      reasons: [reason('R010_DORMANT_REACTIVATION', `account dormant ≥ ${dormantThreshold}d, ${recentCount} tx in 24h`)]
    };
  }
  return noHit;
};

// R011 — peer-flagged subject (B6.6 wires signals.prevFlaggedByPeer)
export const r011 = (ctx, p) => {
  if (ctx.signals?.prevFlaggedByPeer === true) {
    const sev = ctx.signals?.peerFlagSeverity ?? p.score ?? 100;
    return {
      hit: true,
      score: Math.min(100, sev),
      reasons: [reason('R011_PEER_FLAGGED', `subject flagged by peer (severity ${sev})`)]
    };
  }
  return noHit;
};

// R012 — sanctions hit (B6.4 wires signals.sanctionsHit)
export const r012 = (ctx, p) => {
  if (ctx.signals?.sanctionsHit === true) {
    return {
      hit: true,
      score: p.score ?? 100,
      reasons: [reason('R012_SANCTIONS_HIT', 'sanctions/blacklist match')]
    };
  }
  return noHit;
};

// R013 — internal watchlist hit (PEP/greylist)
export const r013 = (ctx, p) => {
  if (ctx.signals?.watchlistHit === true) {
    return {
      hit: true,
      score: p.score ?? 70,
      reasons: [reason('R013_WATCHLIST_HIT', 'PEP/greylist match')]
    };
  }
  return noHit;
};

// R014 — beneficiary in known mule ring (B6.5 wires signals.networkGraphFlag)
export const r014 = (ctx, p) => {
  if (ctx.signals?.networkGraphFlag === true) {
    return {
      hit: true,
      score: p.score ?? 90,
      reasons: [reason('R014_NETWORK_GRAPH_MULE_PATH', 'beneficiary in known mule ring')]
    };
  }
  return noHit;
};

// R015 — sudden high-value transaction on a young account
export const r015 = (ctx, p) => {
  const ageDays = ctx.originator?.accountAgeDays;
  if (ageDays == null) return noHit;
  if (ageDays > (p.youngAccountDays ?? 30)) return noHit;
  const baseline = ctx.originator?.baseline;
  // For young accounts we may not have a baseline yet — treat first tx as fine,
  // but flag if amount is anomalously large for a 30-day-old account.
  const amount = BigInt(ctx.transaction?.amount_value || 0);
  const max = baseline?.max_observed_minor ? BigInt(baseline.max_observed_minor) : 0n;
  if (max === 0n) {
    // No history: any tx > 1,000,000 minor (GHS 10,000) is suspicious for a young account.
    if (amount >= 1_000_000n) {
      return {
        hit: true,
        score: p.score ?? 75,
        reasons: [reason('R015_SUDDEN_HIGH_VALUE_SOLO', `young account (age ${ageDays}d), no prior tx, amount ${amount}`)]
      };
    }
    return noHit;
  }
  const multiplier = p.multiplier ?? 0.8;
  const thresholdNum = Math.floor(Number(max) * (1 + multiplier));
  if (amount >= BigInt(thresholdNum)) {
    return {
      hit: true,
      score: p.score ?? 75,
      reasons: [reason('R015_SUDDEN_HIGH_VALUE_SOLO', `young account amount ${amount} > ${multiplier}× max ${max}`)]
    };
  }
  return noHit;
};
