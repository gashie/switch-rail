# PHASE 6 — Fraud & Risk In Line

**Mode:** Autonomous. Single master prompt, no per-block sign-off.

**Goal at end of phase:**
- Every transaction is scored for risk in single-digit milliseconds at authorization, with the score returned to the originator.
- A rules engine evaluates configurable rules per rail-class, with maker-checker for rule changes.
- Behavioral baselines per account detect "this isn't normal for this customer" patterns.
- An ML scoring hook (model interface) runs alongside the rules engine. The model implementation is pluggable; Phase 6 ships a deterministic feature extractor and a simple logistic-regression scorer with toy weights — real model training is deferred.
- Sanctions, PEP, and BoG/FIC watchlist screening on every leg, on every transaction.
- Network-graph mule ring detection runs as an async background scan, surfacing alerts to the operator and reputation feedback to participants.
- Ghana-specific fraud typologies (Sakawa, SIM swap, MoMo agent fraud, structuring) ship as named rule packs.
- Cross-participant fraud signal exchange — when one participant flags an alias or account as fraud, all participants benefit on subsequent authorization.
- Fast-track fraud reversal (PIX-MED equivalent) — a defined-window mechanism that lets a victim's participant freeze and claw back funds at the receiving participant without going through full disputes.

**Why this phase matters more than disputes.** Disputes (Phase 7) handle the after-the-fact case. Phase 6 stops fraud at authorization, before money moves. Every transaction the fraud engine catches saves the dispute pipeline a case.

---

## What's in scope, what isn't

**In scope (Phase 6):**
- Rules engine (configurable rules, rule packs, maker-checker)
- Behavioral baselines (rolling windows, percentile thresholds)
- ML scoring hook + a simple shipped model (deterministic, no training needed)
- Sanctions / PEP / watchlist screening
- Network-graph mule detection (async scan)
- Cross-participant fraud signal exchange
- Fast-track fraud reversal (MED equivalent)
- Retroactive integration: replace stub `fraud` and `sanctions` checks in B4.2 with real implementations

**NOT in scope (deferred):**
- Federated learning across participants (real ML training across data partitions) → Phase 11+
- Real ML model training pipeline (data labeling, drift monitoring) → Phase 11+
- Real watchlist provider integrations (OFAC API, UN list polling) → Phase 10
- Device fingerprinting (requires participant SDK) → Phase 10
- SAR/STR filing automation (FIC-Ghana integration) → Phase 10

---

## Architectural shape

```
┌─────────────────────────────────────────────────────────────────┐
│                  authorization pipeline (Phase 4 B4.2)            │
│   duplicates → account-status → sanctions → fraud → limits → liq │
└────────────────┬───────────────┬────────────────────────────────┘
                 │               │
       ┌─────────▼─────┐  ┌──────▼────────────┐
       │   sanctions    │  │   fraud (in-line) │
       │  (watchlist    │  │  rules + ML hook  │
       │   service)     │  │                   │
       └────────────────┘  └──────┬────────────┘
                                  │
                          ┌───────▼───────────┐
                          │ behavioral-       │
                          │ baselines         │
                          └───────────────────┘

ASYNC (after authorization, before settlement):
  ┌─────────────────────┐    ┌──────────────────────────┐
  │ network-graph        │    │ fraud-signal-exchange    │
  │ (mule ring scan)     │    │ (participant flags out)  │
  └──────────────────────┘    └──────────────────────────┘

INDEPENDENT:
  ┌─────────────────────┐
  │ fast-track-reversal │
  │ (MED — victim claw- │
  │  back, ≤80 days)     │
  └─────────────────────┘
```

---

## Locked: rule-engine model

A **rule** is one named, deterministic, side-effect-free function that takes a `RuleContext` and returns a `RuleResult`.

```js
const RuleContext = {
  transaction: { ... },
  originator:  { account, participant, accountAge, baseline },
  beneficiary: { account, participant, isFirstTime, daysSinceFirstSeen },
  velocity: {
    last1h: { count, sumMinor },
    last6h: { count, sumMinor },
    last24h: { count, sumMinor, distinctBeneficiaries },
    last7d: { count, sumMinor, distinctBeneficiaries }
  },
  signals: { sanctionsHit: bool, watchlistHit: bool, networkGraphFlag: bool, prevFlaggedByPeer: bool },
  device: { /* deferred: filled when device fingerprinting lands in Phase 10 */ }
};

const RuleResult = {
  verdict: 'PASS' | 'REVIEW' | 'BLOCK',
  score: 0..100,                  // 100 = certain fraud
  reasons: [{ code, message }],
  metadata: { ... }
};
```

**Rule taxonomy** (locked):

| Code | Rule pack | Hint |
|---|---|---|
| `R001_HIGH_VELOCITY_1H` | universal | More than N transactions in last 1h |
| `R002_HIGH_VALUE_VS_BASELINE` | universal | Amount > 5x rolling baseline |
| `R003_NEW_BENEFICIARY_HIGH_VALUE` | universal | First-time beneficiary + amount > threshold |
| `R004_STRUCTURING_PATTERN` | universal | Many sub-threshold tx in tight window |
| `R005_SAKAWA_RAPID_DISPERSAL` | ghana | Inbound credit followed by N+ outbound MoMo within 1h |
| `R006_SIM_SWAP_VELOCITY` | ghana | Sudden velocity spike on alias whose phone changed in last 24h |
| `R007_MOMO_AGENT_PATTERN` | ghana | Account flagged as agent + transactions in unusual hours |
| `R008_GEO_VELOCITY_IMPOSSIBLE` | universal | Time-since-last-tx + claimed location physically impossible |
| `R009_NIGHT_OWL` | universal | Transactions at 2am-4am for an account that historically transacts business hours only |
| `R010_DORMANT_REACTIVATION` | universal | Account dormant >180d suddenly transacting at high velocity |
| `R011_PEER_FLAGGED` | universal | Originator or beneficiary flagged by another participant |
| `R012_SANCTIONS_HIT` | universal | Sanctions/PEP screening hit |
| `R013_WATCHLIST_HIT` | universal | Internal watchlist hit (rail-managed greylist) |
| `R014_NETWORK_GRAPH_MULE_PATH` | universal | Beneficiary in known mule ring |
| `R015_SUDDEN_HIGH_VALUE_SOLO` | universal | Account first 30 days, attempting amount > X% of historical max |

Rules are stored as DB rows with parameters (thresholds, time windows, weights). A **rule pack** is a collection of rules that get enabled together. Phase 6 ships two packs by default: `UNIVERSAL_BASELINE_V1` and `GHANA_TYPOLOGIES_V1`.

**Composition rule:** the engine runs all enabled rules, sums weighted scores, applies rule pack's verdict thresholds. `BLOCK` if composite score ≥ pack's block_threshold (default 80). `REVIEW` if ≥ review_threshold (default 50). `PASS` otherwise.

---

## Locked: fraud verdict mapping to authorization

| Composite verdict | Authorization pipeline |
|---|---|
| `PASS` | Continue pipeline. Score recorded on transaction. |
| `REVIEW` | Continue pipeline (transaction goes through). Score + reasons recorded. Fraud-alert event written for operator review. |
| `BLOCK` | Reject transaction with rail code `FRAUD_BLOCK` → ISO 20022 `XT99` (proprietary; the rail's BIC reason for fraud blocks). |

The decision to use `XT99` rather than `RR04` (regulatory reason) is intentional — fraud is operationally distinct from regulatory in dispute and reporting flows. Add `FRAUD_BLOCK` to `core/codes.js` in B6.1.

The reason `REVIEW` doesn't block the wire is the performance budget (100ms p95) — the system optimizes for not interrupting good customers. Operators handle review-flagged transactions reactively via a Phase 10 ops console.

---

## B6.1 — Fraud module foundation: rule storage, run-context, RAIL_CODES extension

**Purpose.** Set up the fraud module's DB schema, rule storage, rule pack management, and the run-context builder. Extend `core/codes.js` with `FRAUD_BLOCK`. Establish the public surface that Phase 4's stub will be retrofitted to call.

**Files to create.**
- `migrations/0026_fraud_rules.sql`
- `migrations/0027_transaction_fraud_signals.sql`
- `modules/fraud/schema.js`
- `modules/fraud/codes.js` — fraud-specific codes (rule codes, verdicts)
- `modules/fraud/rules-model.js`
- `modules/fraud/rules-service.js`
- `modules/fraud/rule-context-builder.js`
- `modules/fraud/controller.js`
- `modules/fraud/routes.js`
- `modules/fraud/server.js` (port 4501, key `fraudPort`)
- `modules/fraud/index.js`
- `modules/fraud/tests/foundation.test.js`
- **Patch:** `core/codes.js` — add `FRAUD_BLOCK` to `RAIL_CODES`, `XT99` mapping in `REASON_TO_ISO_REASON`, `TERMINAL_FAIL` in `REASON_TO_CATEGORY`.

**`migrations/0026_fraud_rules.sql`:**

```sql
CREATE TABLE IF NOT EXISTS fraud_rule_packs (
  id                  UUID PRIMARY KEY,
  pack_code           TEXT UNIQUE NOT NULL,        -- 'UNIVERSAL_BASELINE_V1', 'GHANA_TYPOLOGIES_V1'
  name                TEXT NOT NULL,
  description         TEXT,
  block_threshold     INT NOT NULL DEFAULT 80,
  review_threshold    INT NOT NULL DEFAULT 50,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fraud_rules (
  id                  UUID PRIMARY KEY,
  rule_code           TEXT UNIQUE NOT NULL,        -- 'R001_HIGH_VELOCITY_1H', etc.
  pack_id             UUID NOT NULL REFERENCES fraud_rule_packs(id),
  name                TEXT NOT NULL,
  description         TEXT,
  weight              INT NOT NULL DEFAULT 50,     -- contribution to composite score on hit
  parameters          JSONB NOT NULL DEFAULT '{}'::jsonb,
  active              BOOLEAN NOT NULL DEFAULT true,
  effective_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to        TIMESTAMPTZ,
  -- maker-checker
  pending_change      JSONB,                        -- proposed updated row
  proposed_by         UUID REFERENCES users(id),
  proposed_at         TIMESTAMPTZ,
  approved_by         UUID REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fraud_rules_pack_idx ON fraud_rules(pack_id);
CREATE INDEX IF NOT EXISTS fraud_rules_active_idx ON fraud_rules(active);

CREATE TABLE IF NOT EXISTS fraud_participant_rule_packs (
  participant_code    TEXT PRIMARY KEY REFERENCES participants(code),
  pack_id             UUID NOT NULL REFERENCES fraud_rule_packs(id),
  enabled             BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`migrations/0027_transaction_fraud_signals.sql`:**

```sql
CREATE TABLE IF NOT EXISTS transaction_fraud_signals (
  id                  UUID PRIMARY KEY,
  transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  source              TEXT NOT NULL,                -- 'rules' | 'ml' | 'sanctions' | 'network-graph' | 'peer-flag'
  composite_verdict   TEXT NOT NULL,                -- 'PASS' | 'REVIEW' | 'BLOCK'
  composite_score     INT NOT NULL,
  rule_hits           JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{ ruleCode, score, reasons }]
  ml_score            NUMERIC(5,4),                 -- 0.0000 - 1.0000
  ml_features         JSONB,
  evaluated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  evaluated_by        TEXT NOT NULL DEFAULT 'in-line'  -- 'in-line' | 'async-graph' | 'manual'
);

CREATE INDEX IF NOT EXISTS tfs_tx_idx ON transaction_fraud_signals(transaction_id);
CREATE INDEX IF NOT EXISTS tfs_review_idx ON transaction_fraud_signals(composite_verdict) WHERE composite_verdict IN ('REVIEW', 'BLOCK');
```

**Maker-checker on rule changes.** A rule update goes via `proposeChange(ruleId, pendingChange)` (writes to `pending_change` JSONB column). A different user calls `approveChange(ruleId)` which applies `pending_change` to the row and clears it. Same user proposing and approving is rejected.

**Rule context builder.** `buildContext({ transaction, envelope, client })` is the canonical function that gathers everything a rule needs:
- velocity windows (queries `transactions` table within 1h/6h/24h/7d)
- baseline (Phase 6 B6.2 fills this in; for B6.1 it returns nulls)
- signals (Phase 6 B6.4-B6.6 fill these in; B6.1 returns false)
- isFirstTime beneficiary (queries `transactions` table, distinct beneficiaries for originator)

The builder is performance-critical. All velocity queries use a single round-trip with PostgreSQL aggregates over an index on `(originator_participant, originator_account, created_at)`. Add this index in B6.1.

**Routes:**
- `GET /fraud/packs` — list packs
- `GET /fraud/packs/:code` — pack with rules
- `POST /fraud/rules/:id/propose` — maker
- `POST /fraud/rules/:id/approve` — checker
- `GET /fraud/rules/:id` — current + pending state
- `GET /fraud/signals/by-transaction/:txId` — fetch all signals for a tx

**Seed (extends `scripts/seed.js`):** insert `UNIVERSAL_BASELINE_V1` and `GHANA_TYPOLOGIES_V1` packs with all 15 rules, default weights and parameters. Enable `UNIVERSAL_BASELINE_V1` for all seeded participants. Enable `GHANA_TYPOLOGIES_V1` for participants with `country_code = 'GH'`.

**Exit checks:** standard. Tests:
- Rule pack creation
- Rule maker-checker (propose, approve happy path; reject same-user-proposes-and-approves)
- Rule context builder produces velocity windows correctly
- Index on `(originator_participant, originator_account, created_at)` exists
- `core/codes.js` patch verified by `core/codes.test.js`

---

## B6.2 — Behavioral baselines

**Purpose.** Per-account baseline of transaction behavior — typical hours, typical amount range, typical beneficiaries — so rules can detect deviations.

**Files to create.**
- `migrations/0028_account_baselines.sql`
- `modules/fraud/baseline-model.js`
- `modules/fraud/baseline-service.js`
- `modules/fraud/baseline-worker.js`            (refreshes baselines daily)
- `modules/fraud/tests/baseline.test.js`
- **Wire:** `rule-context-builder.js` extended to populate `originator.baseline` from `account_baselines` table.

**`migrations/0028_account_baselines.sql`:**

```sql
CREATE TABLE IF NOT EXISTS account_baselines (
  id                  UUID PRIMARY KEY,
  participant_code    TEXT NOT NULL,
  account_id          UUID NOT NULL REFERENCES accounts(id),
  currency            CHAR(3) NOT NULL,
  computed_at         TIMESTAMPTZ NOT NULL,
  observation_window_days  INT NOT NULL,
  -- amount distribution
  median_minor        NUMERIC(38,0),
  p90_minor           NUMERIC(38,0),
  p99_minor           NUMERIC(38,0),
  max_observed_minor  NUMERIC(38,0),
  -- frequency
  daily_count_median  INT,
  daily_count_p90     INT,
  -- temporal
  business_hours_pct  INT,                          -- 0-100, % of tx during 8am-6pm local
  weekend_pct         INT,
  night_pct           INT,                           -- % of tx during 10pm-6am local
  -- beneficiary diversity
  distinct_beneficiaries  INT,
  beneficiary_repeat_rate INT,                       -- 0-100
  -- meta
  total_observations      INT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (account_id, currency)
);

CREATE INDEX IF NOT EXISTS baselines_participant_idx ON account_baselines(participant_code);
```

**Service API:**

```js
recompute(client, { accountId, currency, observationWindowDays })  // pure SQL, runs in caller txn
get({ accountId, currency }) -> baseline | null
listForParticipant(participantCode) -> baselines[]
```

**Baseline worker** (`baseline-worker.js`): runs on a schedule (default daily at 02:00 local), recomputes baselines for any account that had transactions in the last 24h. Uses `SKIP LOCKED` to avoid double-processing. Wired into the EOD post-cutover hook so the baseline refresh isn't blocked by the rest of the day's work.

**Window of observation:** 90 days (configurable per rail-class via env). New accounts (<30 days) explicitly return a "young account" marker rather than a misleading baseline.

**Exit checks:** standard. Tests:
- Recompute on a seeded set of 100 transactions produces correct percentiles
- Hour-of-day buckets sum to 100%
- New account baseline returns the "young" marker
- Worker idempotency (running twice produces same result)

---

## B6.3 — In-line fraud engine + ML hook

**Purpose.** The actual `fraud(context)` function called by the authorization pipeline. Runs all active rules against the context, computes composite verdict and score, optionally calls the ML hook (default deterministic shipped model), persists signals, returns a result. Performance budget: 50ms p95 (25 + 25).

**Files to create.**
- `modules/fraud/engine.js`                (the `evaluate(context)` function)
- `modules/fraud/rule-runners/index.js`    (registry of rule-code → implementation)
- `modules/fraud/rule-runners/r001-r015.js`  (one file per rule, 15 files)
- `modules/fraud/ml/feature-extractor.js`
- `modules/fraud/ml/scorer.js`             (interface)
- `modules/fraud/ml/scorer-default.js`     (deterministic logistic-regression with shipped weights)
- `modules/fraud/signals-model.js`
- `modules/fraud/signals-service.js`
- `modules/fraud/tests/engine.test.js`
- **Patch:** `modules/authorization/checks/fraud.js` — replace stub with real call to `fraudEngine.evaluate(context)`.
- **Patch:** `modules/authorization/pipeline.js` — add `fraud` check between `sanctions` and `limits` (order from CLAUDE.md performance section).

**Rule runners.** Each `r0NN-*.js` file exports one function:

```js
export const r001 = (context, parameters) => {
  // returns { hit: true, score, reasons: [...] } or { hit: false }
};
```

Pure, deterministic, no I/O. The engine's `evaluate` orchestrates: loads active rules, runs each, sums weighted scores, applies thresholds.

**Composite scoring algorithm:**

```js
let composite = 0;
const hits = [];
for (const rule of activeRules) {
  const result = ruleRunners[rule.rule_code](context, rule.parameters);
  if (result.hit) {
    composite += result.score * (rule.weight / 100);
    hits.push({ ruleCode: rule.rule_code, score: result.score, reasons: result.reasons });
  }
}
composite = Math.min(100, Math.round(composite));
const verdict =
  composite >= pack.block_threshold ? 'BLOCK' :
  composite >= pack.review_threshold ? 'REVIEW' :
  'PASS';
```

**ML scorer interface.** `scorer.score(features) -> 0..1`. The default scorer is deterministic logistic regression with hardcoded weights (no training needed). A real model is a Phase 11+ replacement that swaps the implementation behind the same interface. The hook adds at most 25ms; if the scorer's response is needed for the verdict (e.g. weight 30 in the blend), it's in the budget. If not, run async.

**Default ML feature set** (canonical, locked):
- log10(amount_minor)
- isFirstTimeBeneficiary (0/1)
- velocity_1h_count
- velocity_24h_count
- velocity_24h_distinct_beneficiaries
- amount / max_observed_minor (clamped 0..10)
- hour_of_day_score (0..1, baseline-weighted)
- account_age_days (clamped 0..365, divided by 365)
- beneficiary_account_age_days (same)

The shipped default model is deliberately simple — the goal is to prove the hook works end-to-end. Real model is plugged in via env config (`config.fraudMlScorer = 'default' | 'http://internal-ml.local'`).

**Signal persistence.** Every evaluation, regardless of verdict, writes one row to `transaction_fraud_signals`. PASS results have `composite_score`, `rule_hits = []` (or rule-hits below threshold), `ml_score`, `ml_features`. REVIEW writes audit `fraud.review_flagged`. BLOCK writes audit `fraud.blocked`.

**Performance.** All rule queries use the cached `RuleContext` built in B6.1. The context itself is built with one SQL round-trip via aggregates. Rule runners themselves are pure JS and sub-millisecond.

**Exit checks:** standard. Tests:
- Each of 15 rules has a unit test (positive and negative case)
- Composite scoring correctness (3 rules hit with weights 30/40/50, scores 60/70/80 → composite math verified)
- Verdict thresholds applied correctly
- ML hook called, ml_score persisted
- Authorization integration: a high-velocity transaction (R001 hit + R002 hit) reaches BLOCK threshold, authorization pipeline rejects with `FRAUD_BLOCK`/`XT99`
- p95 latency under 50ms with 100-transaction warmup (vitest with `expect(p95).toBeLessThan(50)`)

---

## B6.4 — Sanctions, PEP, watchlist

**Purpose.** Real implementation of the B4.2 `sanctions` stub. Screens originator name, beneficiary name, and account on every transaction. Multi-source watchlist with pluggable provider interface.

**Files to create.**
- `migrations/0029_watchlists.sql`
- `modules/sanctions/schema.js`
- `modules/sanctions/model.js`
- `modules/sanctions/service.js`
- `modules/sanctions/screener.js`           (the matching algorithm)
- `modules/sanctions/providers/local.js`    (the rail's internal lists)
- `modules/sanctions/providers/ofac-fake.js` (fake — Phase 10 swaps for real)
- `modules/sanctions/providers/un-fake.js`
- `modules/sanctions/providers/bog-fake.js`
- `modules/sanctions/controller.js`
- `modules/sanctions/routes.js`
- `modules/sanctions/server.js` (port 4502)
- `modules/sanctions/index.js`
- `modules/sanctions/tests/sanctions.test.js`
- **Patch:** `modules/authorization/checks/sanctions.js` — replace stub.

**`migrations/0029_watchlists.sql`:**

```sql
CREATE TABLE IF NOT EXISTS watchlist_entries (
  id                  UUID PRIMARY KEY,
  source              TEXT NOT NULL,                -- 'OFAC' | 'UN' | 'EU' | 'BOG' | 'FIC' | 'INTERNAL'
  list_type           TEXT NOT NULL,                -- 'SANCTIONS' | 'PEP' | 'GREYLIST' | 'BLACKLIST'
  source_record_id    TEXT,                          -- the source's identifier
  primary_name        TEXT NOT NULL,
  primary_name_norm   TEXT NOT NULL,                 -- normalized for fuzzy match (uses core/strings.js)
  aliases             TEXT[] NOT NULL DEFAULT '{}',
  alias_norms         TEXT[] NOT NULL DEFAULT '{}',
  countries           TEXT[],
  date_of_birth       DATE,
  ghanacard_pin       TEXT,
  account_numbers     TEXT[],
  reason              TEXT,
  added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at          TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS wl_active_idx ON watchlist_entries(source, list_type) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS wl_norm_idx ON watchlist_entries USING gin (primary_name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS wl_alias_norm_idx ON watchlist_entries USING gin (alias_norms);
CREATE INDEX IF NOT EXISTS wl_ghc_idx ON watchlist_entries(ghanacard_pin) WHERE ghanacard_pin IS NOT NULL;

CREATE TABLE IF NOT EXISTS watchlist_screenings (
  id                  UUID PRIMARY KEY,
  transaction_id      UUID REFERENCES transactions(id),
  party               TEXT NOT NULL,                 -- 'ORIGINATOR' | 'BENEFICIARY'
  query_name          TEXT NOT NULL,
  query_account       TEXT,
  hit                 BOOLEAN NOT NULL,
  matches             JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ entryId, source, listType, similarity, matchType }]
  screened_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ws_tx_idx ON watchlist_screenings(transaction_id);
CREATE INDEX IF NOT EXISTS ws_hit_idx ON watchlist_screenings(hit) WHERE hit = true;
```

**Screening algorithm (`screener.js`):**
1. Normalize input name via `core/strings.js` (uppercase, NFD, sort tokens).
2. Direct-key checks first (cheapest): Ghanacard PIN match, exact account number match.
3. Trigram-indexed fuzzy match against `primary_name_norm` and `alias_norms` using `pg_trgm`'s `%` operator.
4. Cap query to top 10 matches by similarity.
5. Apply Jaro-Winkler on top 10 to confirm.
6. Threshold: ≥ 0.92 similarity → `STRONG_MATCH`. 0.80-0.92 → `WEAK_MATCH`. <0.80 → no match.
7. Result: `hit = (any STRONG_MATCH on SANCTIONS or BLACKLIST list)`.

**Verdict tied to authorization:**
- Strong match on `SANCTIONS` or `BLACKLIST` → BLOCK at authorization (rail code `SANCTIONS_HIT` → `XT99` extended with sub-reason)
- Strong match on `PEP` or `GREYLIST` → REVIEW (allow but flag, recorded as fraud signal R013)
- Weak match → record screening but no verdict change

**Performance.** Goal: 15ms p95. Trigram + alias array indexes get this comfortably. Cache the rail's most-queried names in an in-memory LRU (size 10,000) with 60-second TTL — repeats during high-frequency-corridor runs hit the cache.

**Provider seed:** `local` provider seeds 50 entries (operator-managed greylist starting empty). The three `*-fake` providers seed ~100 deterministic test entries each so screening tests don't depend on real OFAC/UN data.

**Exit checks:** standard. Tests:
- Strong match on sanctions list → BLOCK
- Strong match on PEP → REVIEW
- Ghanacard PIN exact match
- Account number exact match
- Cache hit < 5ms p95
- Authorization integration: a transaction whose beneficiary is on the seeded sanctions list rejects with `SANCTIONS_HIT`

---

## B6.5 — Network-graph mule ring detection (async)

**Purpose.** This is the rail's superpower. The rail sees every payment in the country. It can spot mule rings (money flowing in a circle across multiple participants), structuring (lots of small transactions to evade reporting thresholds), and coordinated attacks. Runs **asynchronously** — never blocks authorization. Surfaces alerts to operators and reputation feedback to participants.

**Files to create.**
- `migrations/0030_network_graph.sql`
- `modules/network-graph/schema.js`
- `modules/network-graph/edges-model.js`
- `modules/network-graph/edges-service.js`     (writes graph edges from confirmed transactions)
- `modules/network-graph/scanner.js`            (the algorithms)
- `modules/network-graph/scanner-worker.js`    (batch worker)
- `modules/network-graph/alerts-model.js`
- `modules/network-graph/alerts-service.js`
- `modules/network-graph/controller.js`
- `modules/network-graph/routes.js`
- `modules/network-graph/server.js` (port 4503)
- `modules/network-graph/index.js`
- `modules/network-graph/tests/network-graph.test.js`

**`migrations/0030_network_graph.sql`:**

```sql
CREATE TABLE IF NOT EXISTS graph_edges (
  id                  UUID PRIMARY KEY,
  from_account_key    TEXT NOT NULL,                -- '<participant>:<account>'
  to_account_key      TEXT NOT NULL,
  edge_type           TEXT NOT NULL,                -- 'TRANSFER' (more types added later)
  total_amount_minor  NUMERIC(38,0) NOT NULL DEFAULT 0,
  currency            CHAR(3) NOT NULL,
  tx_count            INT NOT NULL DEFAULT 0,
  first_seen          TIMESTAMPTZ NOT NULL,
  last_seen           TIMESTAMPTZ NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (from_account_key, to_account_key, currency)
);

CREATE INDEX IF NOT EXISTS edges_from_idx ON graph_edges(from_account_key);
CREATE INDEX IF NOT EXISTS edges_to_idx ON graph_edges(to_account_key);
CREATE INDEX IF NOT EXISTS edges_recent_idx ON graph_edges(last_seen DESC);

CREATE TABLE IF NOT EXISTS graph_alerts (
  id                  UUID PRIMARY KEY,
  alert_type          TEXT NOT NULL,                -- 'MULE_RING' | 'STRUCTURING' | 'COORDINATED_BURST'
  account_keys        TEXT[] NOT NULL,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence            JSONB NOT NULL,
  composite_score     INT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'investigating' | 'confirmed' | 'dismissed'
  resolved_by         UUID REFERENCES users(id),
  resolved_at         TIMESTAMPTZ,
  resolution_notes    TEXT
);

CREATE INDEX IF NOT EXISTS alerts_status_idx ON graph_alerts(status);
CREATE INDEX IF NOT EXISTS alerts_type_idx ON graph_alerts(alert_type);
```

**Edge writer.** Every `CONFIRMED` transaction triggers an upsert on `graph_edges` (post-confirmation, async via background worker — never in the hot path). Increments `tx_count` and `total_amount_minor`, updates `last_seen`. Wired via the conservative-reversal-style audit pattern: orchestrator writes audit `transaction.confirmed_for_graph`; worker subscribes.

**Scanners (3 in Phase 6):**

1. **Mule ring (cycle detection).** Find cycles A → B → C → A within a 24h window where each edge `total_amount_minor` is within 5% of the others (money flowing back to start with minor extraction). Algorithm: limited-depth DFS from accounts that received >5 inbound transactions in last 24h, depth ≤ 5. Bounded by visit count.

2. **Structuring.** Account whose 24h cumulative outbound exceeds reporting threshold (default 10,000 GHS-minor units = 1,000,000 = GHS 10,000) but no individual transaction does. Cumulative across N+ outbound to distinct beneficiaries.

3. **Coordinated burst.** N+ accounts (default 5) sending to a single beneficiary within a tight window (default 30 minutes) where each account's send is statistically anomalous against its own baseline.

Each scanner is a pure function over the edges + transactions tables. Returns alerts with evidence (involved account keys, transaction IDs, amounts, time window).

**Scanner worker.** Runs on a schedule (default every 5 minutes). Pulls confirmed transactions from the last interval, runs scanners on the affected subgraphs, writes alerts.

**Reputation feedback.** When a `MULE_RING` alert is `confirmed` (operator action), the involved accounts get a marker that boosts their score on subsequent fraud rule R014 (`R014_NETWORK_GRAPH_MULE_PATH`). The reputation marker is on `accounts.metadata.fraudReputation` and flows back into the rule context builder.

**Routes:**
- `GET /network-graph/edges/:accountKey` — adjacency
- `GET /network-graph/alerts` — list with filters
- `GET /network-graph/alerts/:id` — detail with evidence
- `POST /network-graph/alerts/:id/resolve` — admin
- `POST /network-graph/scan` — admin trigger immediate scan

**Exit checks:** standard. Tests:
- Edge upserts on confirmed transaction
- Mule ring: seed a 4-cycle with matching amounts, scanner detects
- Structuring: seed 15 sub-threshold tx in 24h, scanner detects
- Coordinated burst: seed 7 accounts → 1 beneficiary in 20min, scanner detects
- Reputation feedback: confirmed alert flips rule R014 hit on subsequent transaction

---

## B6.6 — Cross-participant fraud signal exchange

**Purpose.** When one participant flags an alias or account as fraud, all participants benefit on subsequent authorization. This is the rail's network effect — central visibility helps everyone.

**Files to create.**
- `migrations/0031_fraud_flags.sql`
- `modules/fraud-flags/schema.js`
- `modules/fraud-flags/model.js`
- `modules/fraud-flags/service.js`
- `modules/fraud-flags/controller.js`
- `modules/fraud-flags/routes.js`
- `modules/fraud-flags/server.js` (port 4504)
- `modules/fraud-flags/index.js`
- `modules/fraud-flags/tests/flags.test.js`
- **Wire:** `rule-context-builder.js` extended to populate `signals.prevFlaggedByPeer` from `fraud_flags`. R011 (`R011_PEER_FLAGGED`) becomes active.

**`migrations/0031_fraud_flags.sql`:**

```sql
CREATE TABLE IF NOT EXISTS fraud_flags (
  id                  UUID PRIMARY KEY,
  flagged_subject_type TEXT NOT NULL,               -- 'ACCOUNT' | 'ALIAS' | 'BENEFICIARY_NAME'
  flagged_subject_key  TEXT NOT NULL,                -- e.g. 'BANK01:0123' or 'PHONE:+233...' or 'NAME:KOFI MENSAH:GHA-...'
  flag_type           TEXT NOT NULL,                 -- 'CONFIRMED_FRAUD' | 'SUSPICIOUS' | 'STOLEN_DEVICE' | 'COMPROMISED_ALIAS'
  flagged_by           TEXT NOT NULL,                -- participant code
  evidence            JSONB,
  severity            INT NOT NULL DEFAULT 70,       -- 1-100
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,                    -- when the flag rolls off (default 90 days)
  withdrawn_at        TIMESTAMPTZ,                    -- if the flagging participant withdraws
  UNIQUE (flagged_subject_type, flagged_subject_key, flagged_by, flag_type)
);

CREATE INDEX IF NOT EXISTS fflags_subject_active_idx ON fraud_flags(flagged_subject_type, flagged_subject_key)
  WHERE withdrawn_at IS NULL AND (expires_at IS NULL OR expires_at > now());
```

**Service API:**

```js
flag({ subjectType, subjectKey, flagType, flaggedBy, evidence, severity, expiresInDays }) -> flag
withdraw({ flagId, withdrawnBy })
listActive({ subjectType, subjectKey }) -> flags[]      // for use in rule context
expireRolloff()                                          // worker, runs daily at EOD
```

**Severity composition for rule R011.** The rule fires when `signals.prevFlaggedByPeer` is true. Score is the max severity across active flags. Single `CONFIRMED_FRAUD` flag at severity 90 triggers a near-block. Multiple `SUSPICIOUS` flags at severity 30 each from different participants compound.

**Routes (mTLS-only — participants directly call this; not the operator console):**
- `POST /fraud-flags` — flag a subject
- `POST /fraud-flags/:id/withdraw` — withdraw
- `GET /fraud-flags/active` — query active flags

**Exit checks:** standard. Tests:
- Flag created and retrievable
- Active flag expires after `expires_at`
- Flag withdrawn → no longer active
- Rule R011 hit when active flag exists for beneficiary
- Multiple flags compound severity

---

## B6.7 — Fast-track fraud reversal (MED equivalent)

**Purpose.** PIX has the *Mecanismo Especial de Devolução* — a defined-window mechanism that lets a victim's bank trigger a freeze and clawback at the receiving bank without going through full disputes. We adopt the same. Window: 80 days from the original transaction's confirmation. Fraud-confirmed clawbacks go through this fast path; everything else goes through Phase 7 disputes.

**Files to create.**
- `migrations/0032_fast_track_reversals.sql`
- `modules/fast-track-reversal/schema.js`
- `modules/fast-track-reversal/model.js`
- `modules/fast-track-reversal/service.js`
- `modules/fast-track-reversal/controller.js`
- `modules/fast-track-reversal/routes.js`
- `modules/fast-track-reversal/server.js` (port 4505)
- `modules/fast-track-reversal/index.js`
- `modules/fast-track-reversal/tests/fast-track.test.js`

**`migrations/0032_fast_track_reversals.sql`:**

```sql
CREATE TABLE IF NOT EXISTS fast_track_reversals (
  id                  UUID PRIMARY KEY,
  original_transaction_id  UUID NOT NULL REFERENCES transactions(id),
  reversal_transaction_id  UUID REFERENCES transactions(id),  -- created when freeze succeeds
  victim_participant       TEXT NOT NULL,
  receiving_participant    TEXT NOT NULL,
  invoked_by               UUID NOT NULL REFERENCES users(id),
  invoked_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence                 JSONB NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'invoked',  -- 'invoked' | 'frozen' | 'completed' | 'rejected' | 'expired'
  freeze_attempted_at      TIMESTAMPTZ,
  receiving_acknowledged_at TIMESTAMPTZ,
  reason_code              TEXT NOT NULL,
  reason_message           TEXT,
  resolved_at              TIMESTAMPTZ,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ftr_state_idx ON fast_track_reversals(state);
CREATE INDEX IF NOT EXISTS ftr_orig_idx ON fast_track_reversals(original_transaction_id);
```

**Window enforcement.** `service.invoke({ originalTransactionId, evidence, reasonCode })` rejects if the original transaction's `confirmed_at` is older than 80 days (configurable via `config.fastTrackReversalWindowDays`).

**Flow:**
1. Victim participant calls `POST /fast-track-reversal/invoke`.
2. Service validates: original is `CONFIRMED`, within window, victim is the original originator.
3. Service immediately calls receiving participant's freeze endpoint (new endpoint on the participant HTTP contract — see below). Status check, freeze attempt, response within 10s.
4. If receiving participant freezes successfully → invoke standard `reversals.initiate()` flow with reason `FRAD`. Audit `fast_track.completed`.
5. If receiving participant rejects (insufficient funds — beneficiary already withdrew) → state `rejected`, audit `fast_track.rejected`. Victim's options narrow to Phase 7 disputes.
6. If receiving participant times out → retry once with backoff. Then `expired` if still no response.

**Participant contract extension.** New endpoint on every participant: `POST {endpoints.freeze}` with body `{ accountId, holdAmountMinor, currency, reason, originalTransactionId }`. Returns `{ ok: true, frozenAt }` or `{ ok: false, error }`. The rail's simulator implements it with the same force-account taxonomy (`9999000003` returns "account closed", `9999000007` times out, etc.).

**Audit-event-then-confirm rule applies.** A successful freeze does NOT auto-execute the reversal. Operator (or fraud-confirmed automation in a future phase) confirms the reversal. The freeze is the holding action; the reversal is the money movement.

**Limits.** A participant's monthly fast-track-invoke quota (default 1,000) prevents abuse. Tracked in fraud signals.

**Routes:**
- `POST /fast-track-reversal/invoke` — body `{originalTransactionId, evidence, reasonCode}`
- `POST /fast-track-reversal/:id/confirm-reversal` — admin or automated subscriber
- `GET /fast-track-reversal/:id` — fetch
- `GET /fast-track-reversal` — list with filters

**Exit checks:** standard. Tests:
- Within-window invoke succeeds, simulator freezes, reversal confirmable
- Outside-window invoke rejected
- Receiving participant rejects (account 9999000003) → state `rejected`
- Timeout (account 9999000007) → retry → eventual `expired`
- Quota enforcement: 1001st invoke from same participant in same month rejected

---

## B6.8 — Phase 6 exit gate

**Purpose.** Lock the phase. Demo proves: a high-velocity fraud scenario gets blocked at authorization, a sanctions hit gets blocked, a mule ring gets detected and surfaced as an alert, a peer-flagged beneficiary boosts subsequent rule scores, a fast-track reversal succeeds end-to-end.

**Files to create.**
- `scripts/demo-phase-6.sh`
- `tests/phase-6-fraud-e2e.test.js`

**Demo flow:**
1. Setup: 3 participants active, sanctions list seeded with `OSAMA_TEST_PERSON`, mule-ring fixture seeded.
2. Run a transaction → PASS, score < review threshold.
3. Run high-velocity scenario (10 transactions in 30 seconds from one account) → 11th gets BLOCK with rule hits R001/R002.
4. Run a transaction with beneficiary name `OSAMA TEST PERSON` → BLOCK with `SANCTIONS_HIT`.
5. Run the mule-ring fixture (4 accounts in cycle), wait for scanner worker, query `/network-graph/alerts` → MULE_RING alert present.
6. Confirm the alert. Run a new transaction to one of the involved accounts → R014 hits.
7. Participant A flags an account belonging to Participant B's customer. Run a transaction from Participant C to that flagged account → R011 hits.
8. Pick one CONFIRMED transaction from step 2 within window. Invoke fast-track reversal (force-account variants for freeze success / freeze fail / timeout). Confirm reversal in success path. Verify reversal reaches `REVERSED` state.
9. Print `PHASE 6 OK`.

**Phase 6 exit gate (paste output):**
- `bash scripts/demo-phase-6.sh` — prints `PHASE 6 OK`
- `pnpm vitest run` — all green; expect ~750+ total
- `pnpm lint`, `pnpm check-boundaries` — clean
- `pnpm reset && pnpm migrate && pnpm seed` — 32 migrations apply clean
- `git log --oneline | head -55` — shows 8 phase-6 commits
- One latency assertion: `pnpm vitest run tests/phase-6-fraud-e2e.test.js` includes a p95 timer that confirms authorization pipeline still under 100ms even with all Phase 6 checks lit up.

---

## What "PHASE 6 OK" unlocks

After Phase 6:
- Every transaction is scored for risk in line, with structured rule hits and ML score.
- Sanctions, PEP, watchlist screening blocks bad actors at authorization.
- Network-graph mule detection runs continuously, surfacing alerts that no individual participant could see.
- Cross-participant fraud signal exchange means a flag on one platform protects all.
- Fast-track reversal closes the loop on confirmed fraud within an 80-day window.
- Phase 7 (disputes) handles everything else — the slow, careful, evidence-based path.
- Phase 9 (cross-border) inherits the entire fraud stack — sanctions screening on every leg, the rules engine running on cross-border-classified transactions, the network graph including foreign rails as nodes.
