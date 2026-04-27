// Locked fraud codes per PHASES/PHASE-6.md. Rule codes, verdicts, and
// rule pack codes are constants the engine and operator console key off.

export const VERDICTS = Object.freeze({
  PASS:   'PASS',
  REVIEW: 'REVIEW',
  BLOCK:  'BLOCK'
});

export const RULE_CODES = Object.freeze({
  R001_HIGH_VELOCITY_1H:        'R001_HIGH_VELOCITY_1H',
  R002_HIGH_VALUE_VS_BASELINE:  'R002_HIGH_VALUE_VS_BASELINE',
  R003_NEW_BENEFICIARY_HIGH_VALUE: 'R003_NEW_BENEFICIARY_HIGH_VALUE',
  R004_STRUCTURING_PATTERN:     'R004_STRUCTURING_PATTERN',
  R005_SAKAWA_RAPID_DISPERSAL:  'R005_SAKAWA_RAPID_DISPERSAL',
  R006_SIM_SWAP_VELOCITY:       'R006_SIM_SWAP_VELOCITY',
  R007_MOMO_AGENT_PATTERN:      'R007_MOMO_AGENT_PATTERN',
  R008_GEO_VELOCITY_IMPOSSIBLE: 'R008_GEO_VELOCITY_IMPOSSIBLE',
  R009_NIGHT_OWL:               'R009_NIGHT_OWL',
  R010_DORMANT_REACTIVATION:    'R010_DORMANT_REACTIVATION',
  R011_PEER_FLAGGED:            'R011_PEER_FLAGGED',
  R012_SANCTIONS_HIT:           'R012_SANCTIONS_HIT',
  R013_WATCHLIST_HIT:           'R013_WATCHLIST_HIT',
  R014_NETWORK_GRAPH_MULE_PATH: 'R014_NETWORK_GRAPH_MULE_PATH',
  R015_SUDDEN_HIGH_VALUE_SOLO:  'R015_SUDDEN_HIGH_VALUE_SOLO'
});

export const PACK_CODES = Object.freeze({
  UNIVERSAL_BASELINE_V1: 'UNIVERSAL_BASELINE_V1',
  GHANA_TYPOLOGIES_V1:   'GHANA_TYPOLOGIES_V1'
});

// Rule weights. The composite scoring algorithm sums (rule.score *
// weight/100). A weight of 100 means the rule's raw score is added at full
// strength; weight 50 halves it. Defaults below are tuned so a single
// confirmed signal (say R012 sanctions) is enough to BLOCK at the default
// pack threshold of 80.
export const DEFAULT_RULE_WEIGHTS = Object.freeze({
  R001_HIGH_VELOCITY_1H:        70,
  R002_HIGH_VALUE_VS_BASELINE:  60,
  R003_NEW_BENEFICIARY_HIGH_VALUE: 50,
  R004_STRUCTURING_PATTERN:     80,
  R005_SAKAWA_RAPID_DISPERSAL:  90,
  R006_SIM_SWAP_VELOCITY:       80,
  R007_MOMO_AGENT_PATTERN:      40,
  R008_GEO_VELOCITY_IMPOSSIBLE: 90,
  R009_NIGHT_OWL:               30,
  R010_DORMANT_REACTIVATION:    50,
  R011_PEER_FLAGGED:            85,
  R012_SANCTIONS_HIT:           100,
  R013_WATCHLIST_HIT:           60,
  R014_NETWORK_GRAPH_MULE_PATH: 90,
  R015_SUDDEN_HIGH_VALUE_SOLO:  60
});

// Default rule parameters (tunable via rule pack maker-checker flow).
export const DEFAULT_RULE_PARAMETERS = Object.freeze({
  R001_HIGH_VELOCITY_1H:        { thresholdCount: 8, score: 80 },
  R002_HIGH_VALUE_VS_BASELINE:  { multiplier: 5, score: 75 },
  R003_NEW_BENEFICIARY_HIGH_VALUE: { thresholdMinor: '500000', score: 60 },
  R004_STRUCTURING_PATTERN:     { windowHours: 24, minCount: 8, maxIndividualMinor: '500000', score: 85 },
  R005_SAKAWA_RAPID_DISPERSAL:  { inboundWindowMinutes: 60, dispersalCount: 3, score: 90 },
  R006_SIM_SWAP_VELOCITY:       { simSwapWindowHours: 24, velocityMultiplier: 3, score: 85 },
  R007_MOMO_AGENT_PATTERN:      { unusualHourStart: 23, unusualHourEnd: 5, score: 50 },
  R008_GEO_VELOCITY_IMPOSSIBLE: { score: 95 },
  R009_NIGHT_OWL:               { businessHourMinPct: 80, nightStart: 2, nightEnd: 4, score: 40 },
  R010_DORMANT_REACTIVATION:    { dormantDays: 180, reactivationVelocity: 5, score: 70 },
  R011_PEER_FLAGGED:            { score: 100 },
  R012_SANCTIONS_HIT:           { score: 100 },
  R013_WATCHLIST_HIT:           { score: 70 },
  R014_NETWORK_GRAPH_MULE_PATH: { score: 90 },
  R015_SUDDEN_HIGH_VALUE_SOLO:  { youngAccountDays: 30, multiplier: 0.8, score: 75 }
});

export const SOURCES = Object.freeze({
  RULES: 'rules',
  ML: 'ml',
  SANCTIONS: 'sanctions',
  NETWORK_GRAPH: 'network-graph',
  PEER_FLAG: 'peer-flag'
});

export const EVALUATED_BY = Object.freeze({
  IN_LINE: 'in-line',
  ASYNC_GRAPH: 'async-graph',
  MANUAL: 'manual'
});
