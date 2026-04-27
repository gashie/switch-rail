# PHASE 4 — Core Transaction Lifecycle

**Mode:** Autonomous. Single master prompt, no per-block sign-off.

**Goal at end of phase:** A real payment moves end-to-end through the rail with structured response codes, idempotency, atomic outcome, recovery, receipts, and reversals — in three wire formats (REST, ISO 20022, ISO 8583). Every participant in the rail can be addressed via the directory built in Phase 3. The simulator stands in for real participants in dev/test, and is itself the reference implementation of the participant HTTP contract that real banks will follow.

**This is the most architecturally critical phase.** Phase 5 (settlement & ledger) hangs off the state-transition hooks defined here. Phase 6 (fraud) hangs off the authorization pipeline defined here. Phase 7 (disputes) hangs off the reversal taxonomy defined here. Get this phase right and the rest of the build is mostly mechanical.

---

## What's in scope, what isn't

**In scope (Phase 4):**
- The transactions table, state machine, immutable status history
- Authorization pipeline (with stubs for liquidity, sanctions, fraud — those plug in fully in Phases 5/6)
- Routing (BIN tables, alias resolution) and multi-rail orchestration (rail-class registry)
- Credit-leg HTTP contract — the canonical interface every participant implements
- Participant simulator (dev/test only) that implements the credit-leg contract
- Atomic outcome (CONFIRMED or REJECTED, no in-between visible to participants)
- Recovery worker (timeout retry, escalation, eventual auto-reversal)
- Confirmation flow (Ed25519-signed receipts to both sides)
- Reversals (linked unwinds with structured return reason codes)
- Demo: REST → ISO 20022 → ISO 8583 round-trips through full lifecycle

**NOT in scope (deferred to later phases):**
- Settlement positions and ledger movement → Phase 5
- Liquidity floors/ceilings/throttling → Phase 5
- Real fraud scoring → Phase 6
- Real sanctions screening → Phase 6
- Disputes (reversals are *not* disputes) → Phase 7
- Overlays (R2P, QR, mandates, bulk, etc.) → Phase 8
- Cross-border atomicity → Phase 9

---

## Architectural shape

```
                           ┌──────────────────────────────┐
                           │       transactions            │
                           │   (state machine + history)   │
                           └─────────┬────────────────────┘
                                     │
       ┌─────────────────────────────┴────────────────────────────────┐
       │                             │                                │
┌──────▼──────┐  ┌──────────────────▼────────────┐  ┌────────────────▼─────────────┐
│authorization │  │           routing              │  │       credit-leg              │
│ pipeline     │  │  (BIN, alias → participant,    │  │ (HTTP call to beneficiary,    │
│              │  │   rail-class selection)        │  │  timeout, response handling) │
└──────────────┘  └────────────────────────────────┘  └─────────────┬────────────────┘
                                                                    │
                                                       ┌────────────▼──────────────┐
                                                       │   participant-simulator    │
                                                       │ (dev/test reference impl)  │
                                                       └────────────────────────────┘

      ┌────────────────────┐                                ┌──────────────────────┐
      │ transaction-       │  drives recovery for           │     reversals        │
      │ recovery (worker)  │  PENDING_RECONCILIATION        │  (linked unwinds)    │
      └────────────────────┘                                └──────────────────────┘
```

---

## Locked: transaction state machine

These states and transitions are exhaustive. CC must not invent more.

```
RECEIVED  ─(authorize OK)─────▶ AUTHORIZED
RECEIVED  ─(authorize fail)──▶ REJECTED              (terminal)

AUTHORIZED ─(routing OK)───── ▶ ROUTED
AUTHORIZED ─(routing fail)──▶ REJECTED               (terminal)

ROUTED   ─(credit-leg call)──▶ CREDIT_LEG_PENDING

CREDIT_LEG_PENDING ─(success)─▶ CONFIRMED            (terminal-success)
CREDIT_LEG_PENDING ─(terminal fail)─▶ REJECTED       (terminal)
CREDIT_LEG_PENDING ─(timeout / unknown)─▶ PENDING_RECONCILIATION

PENDING_RECONCILIATION ─(recovery confirms credited)─▶ CONFIRMED
PENDING_RECONCILIATION ─(recovery confirms NOT credited)─▶ REJECTED
PENDING_RECONCILIATION ─(retries exhaust, possibly credited)─▶ FAILED
                                                      └─(auto-reversal triggered)

CONFIRMED ─(reversal applied)─▶ REVERSED              (terminal)

ANY non-terminal ─(operator kill-switch)─▶ REJECTED   (per CLAUDE.md kill-switch rule)
```

**Terminal states:** `CONFIRMED`, `REJECTED`, `REVERSED`, `FAILED`. From these, no further transitions.

**Audit events for every transition.** Status history table is append-only.

---

## Locked: the participant HTTP contract

This is the single canonical contract every real participant must implement. The simulator implements it as the reference. Real participants will be onboarded in Phase 3+ with their endpoints registered in `participants.endpoints`.

### Credit-leg endpoint

`POST {participant.endpoints.credit_leg}`

Headers:
- `Content-Type: application/json`
- `X-Sika-Signature: <base64 Ed25519>`
- `X-Sika-Kid: <key id>`
- `X-Sika-Request-Id: <uuid>`

Body (canonical JSON — see `core/json.js`):

```json
{
  "envelopeId": "uuid-v7",
  "transactionId": "uuid-v7",
  "endToEndId": "...",
  "amount": { "value": "15000", "currency": "GHS" },
  "originator": { "participantCode": "BANK01", "accountId": "...", "name": "..." },
  "beneficiary": { "participantCode": "BANK02", "accountId": "...", "name": "..." },
  "reference": "...",
  "remittance": "...",
  "purposeCode": "GDDS",
  "settlementMethod": "CLRG"
}
```

Response (within 10 seconds, 5 second target):

Success:
```json
{
  "ok": true,
  "data": {
    "responseCode": "ACSC",
    "creditedAt": "2026-04-26T12:34:56.789Z",
    "beneficiaryRef": "BANK02-credit-id-12345"
  }
}
```

Failure:
```json
{
  "ok": false,
  "error": {
    "code": "AC04",
    "message": "Closed Account Number"
  }
}
```

If no response within 10 seconds, the rail treats it as TIMEOUT and enters `PENDING_RECONCILIATION`.

### Status-check endpoint (used by recovery)

`POST {participant.endpoints.status_check}`

Body:
```json
{
  "transactionId": "...",
  "endToEndId": "..."
}
```

Response:
```json
{
  "ok": true,
  "data": {
    "found": true,
    "status": "credited" | "not_credited" | "pending",
    "creditedAt": "..."
  }
}
```

If `found: false`, the participant has no record — recovery treats it as not-credited.

### Reversal endpoint

`POST {participant.endpoints.reversal}`

Body:
```json
{
  "originalTransactionId": "...",
  "reversalTransactionId": "...",
  "reasonCode": "DUPL",
  "amount": { "value": "15000", "currency": "GHS" }
}
```

Response:
```json
{ "ok": true, "data": { "reversedAt": "..." } }
```

---

## Locked: force-behavior account ranges

For dev/test, account numbers in the range `9999000000`–`9999000099` reserved at the simulator. The simulator's response is determined by the beneficiary account number alone:

| Account | Behavior |
|---|---|
| `9999000001` | SUCCESS (fast, ~50ms) |
| `9999000002` | REJECTED with `AM04` Insufficient Funds |
| `9999000003` | REJECTED with `AC04` Closed Account |
| `9999000004` | REJECTED with `AC06` Blocked Account |
| `9999000005` | REJECTED with `AG01` Transaction Forbidden |
| `9999000006` | REJECTED with `RR04` Regulatory Reason |
| `9999000007` | TIMEOUT (no response within 10s) |
| `9999000008` | SLOW_RESPONSE (responds at ~7s, just under timeout) |
| `9999000009` | INTERMITTENT (50% success, 50% timeout — based on hash of transactionId) |
| `9999000010` | UNREACHABLE (TCP-level error) |
| Any other account | SUCCESS |

These force-accounts are seeded by `scripts/seed.js` under the `BANK_TEST` participant.

---

## Locked: ISO 20022 response code mapping

The rail maps internal results to ISO 20022 codes for outbound responses (pacs.002, pacs.004).

**Status codes** (used in pacs.002 `TxSts`):

| Internal state | ISO 20022 |
|---|---|
| RECEIVED | `RCVD` |
| AUTHORIZED | `ACTC` |
| ROUTED | `ACSP` |
| CREDIT_LEG_PENDING | `ACSP` |
| CONFIRMED | `ACSC` |
| PENDING_RECONCILIATION | `PDNG` |
| REJECTED | `RJCT` |
| FAILED | `RJCT` |
| REVERSED | `ACSC` (the reversal pacs.004 carries the unwind) |

**Reason codes** (used with RJCT in pacs.002 `StsRsnInf/Rsn/Cd`):

| Rail code | ISO 20022 | Meaning |
|---|---|---|
| BENEFICIARY_ACCOUNT_NOT_FOUND | `AC01` | Incorrect Account Number |
| BENEFICIARY_ACCOUNT_CLOSED | `AC04` | Closed Account |
| BENEFICIARY_ACCOUNT_BLOCKED | `AC06` | Blocked Account |
| TRANSACTION_FORBIDDEN | `AG01` | Transaction Forbidden |
| INSUFFICIENT_FUNDS | `AM04` | Insufficient Funds |
| DUPLICATE | `AM05` | Duplication |
| INVALID_END_CUSTOMER | `BE01` | Inconsistent With End Customer |
| INVALID_DATE | `DT01` | Invalid Date |
| SETTLEMENT_FAILED | `ED05` | Settlement Failed |
| INVALID_FORMAT | `FF01` | Invalid File Format |
| BENEFICIARY_DECEASED | `MD07` | End Customer Deceased |
| REGULATORY | `RR04` | Regulatory Reason |
| CUTOFF_TIME | `TM01` | Cut Off Time |
| OPERATOR_KILL_SWITCH | `RR04` | Regulatory Reason (with additional info) |
| RAIL_INTERNAL_ERROR | `XT99` | Reserved (proprietary) |

Lock these in `core/codes.js` (authorized core addition for B4.3).

---

## B4.1 — `modules/transactions/` (table, state machine, ingestion)

**Purpose.** The transactions table is the rail's record of every payment lifecycle. Every payment instruction (envelope) becomes a transaction. The transaction state machine is the source of truth for what happened.

**Files to create.**
- `migrations/0013_transactions.sql`
- `modules/transactions/schema.js` — Joi for ingest, query
- `modules/transactions/states.js` — locked state-machine constants + valid-transition matrix
- `modules/transactions/model.js`
- `modules/transactions/service.js`
- `modules/transactions/controller.js`
- `modules/transactions/routes.js`
- `modules/transactions/server.js` (port 4301, key `transactionsPort`)
- `modules/transactions/index.js`
- `modules/transactions/tests/transactions.test.js`

**`migrations/0013_transactions.sql`:**

```sql
CREATE TABLE IF NOT EXISTS transactions (
  id                       UUID PRIMARY KEY,
  envelope_id              UUID NOT NULL REFERENCES envelopes(envelope_id) ON DELETE RESTRICT,
  end_to_end_id            TEXT NOT NULL,
  state                    TEXT NOT NULL,                    -- see states.js
  rail_class               TEXT NOT NULL,                    -- 'DOMESTIC_INSTANT' | 'DOMESTIC_BATCH' | 'MOBILE_MONEY_INTEROP' | 'FOREIGN'
  originator_participant   TEXT NOT NULL,
  originator_account       TEXT NOT NULL,
  beneficiary_participant  TEXT NOT NULL,
  beneficiary_account      TEXT NOT NULL,
  amount_value             NUMERIC(38,0) NOT NULL,
  amount_currency          CHAR(3) NOT NULL,
  response_code            TEXT,                              -- ISO 20022 code on terminal
  reason_code              TEXT,                              -- internal rail code on rejection
  reason_message           TEXT,
  authorized_at            TIMESTAMPTZ,
  routed_at                TIMESTAMPTZ,
  credit_leg_started_at    TIMESTAMPTZ,
  confirmed_at             TIMESTAMPTZ,
  rejected_at              TIMESTAMPTZ,
  reversed_at              TIMESTAMPTZ,
  failed_at                TIMESTAMPTZ,
  reversal_transaction_id  UUID REFERENCES transactions(id),
  original_transaction_id  UUID REFERENCES transactions(id),  -- non-null on reversal txns
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_envelope_idx ON transactions(envelope_id);
CREATE INDEX IF NOT EXISTS transactions_state_idx ON transactions(state);
CREATE INDEX IF NOT EXISTS transactions_originator_idx ON transactions(originator_participant);
CREATE INDEX IF NOT EXISTS transactions_beneficiary_idx ON transactions(beneficiary_participant);
CREATE INDEX IF NOT EXISTS transactions_e2e_idx ON transactions(end_to_end_id);
CREATE INDEX IF NOT EXISTS transactions_pending_recon_idx ON transactions(state) WHERE state = 'PENDING_RECONCILIATION';

CREATE TABLE IF NOT EXISTS transaction_status_history (
  id                  UUID PRIMARY KEY,
  transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  from_state          TEXT,                                  -- null on initial RECEIVED
  to_state            TEXT NOT NULL,
  reason_code         TEXT,
  reason_message      TEXT,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurred_by         TEXT NOT NULL                          -- 'system' | 'operator:<userId>' | 'recovery-worker'
);

CREATE INDEX IF NOT EXISTS tsh_transaction_idx ON transaction_status_history(transaction_id);
CREATE INDEX IF NOT EXISTS tsh_occurred_idx ON transaction_status_history(occurred_at);
```

**`states.js` content (locked — copy verbatim):**

```js
export const STATES = Object.freeze({
  RECEIVED: 'RECEIVED',
  AUTHORIZED: 'AUTHORIZED',
  ROUTED: 'ROUTED',
  CREDIT_LEG_PENDING: 'CREDIT_LEG_PENDING',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  PENDING_RECONCILIATION: 'PENDING_RECONCILIATION',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED'
});

export const TERMINAL_STATES = Object.freeze(['CONFIRMED', 'REJECTED', 'REVERSED', 'FAILED']);

export const VALID_TRANSITIONS = Object.freeze({
  RECEIVED: ['AUTHORIZED', 'REJECTED'],
  AUTHORIZED: ['ROUTED', 'REJECTED'],
  ROUTED: ['CREDIT_LEG_PENDING', 'REJECTED'],
  CREDIT_LEG_PENDING: ['CONFIRMED', 'REJECTED', 'PENDING_RECONCILIATION'],
  PENDING_RECONCILIATION: ['CONFIRMED', 'REJECTED', 'FAILED'],
  CONFIRMED: ['REVERSED'],
  REJECTED: [],
  REVERSED: [],
  FAILED: []
});

export const isTerminal = (s) => TERMINAL_STATES.includes(s);
export const canTransition = (from, to) =>
  to === 'REJECTED' && !isTerminal(from)              // operator kill-switch
    ? true
    : (VALID_TRANSITIONS[from] || []).includes(to);
```

**Service API (`service.js`):**

```js
ingestFromEnvelope(client, envelope) -> transaction       // creates RECEIVED row + initial history entry
transition(client, txId, toState, { reasonCode, reasonMessage, occurredBy, payload }) -> transaction
findById(client, id) -> transaction
findByEnvelopeId(client, envelopeId) -> transaction | null
findByEndToEndId(client, e2e) -> transaction | null
listPendingReconciliation(client, { olderThanSeconds, limit }) -> transactions[]
listForParticipant(client, participantCode, { state, limit, offset })
operatorKillSwitch(client, txId, { reason, operatorId }) -> transaction
```

`transition` enforces `canTransition`, writes the status history row in the same transaction, sets the appropriate timestamp column, and writes one audit event `transaction.<to_state>`.

**Routes:**
- `POST /transactions/ingest` — body: envelope. Idempotent: if envelope already has a transaction, return existing.
- `GET /transactions/:id` — full state + history
- `GET /transactions/:id/history` — just history
- `POST /transactions/:id/kill` — admin only — operator kill-switch

**Exit checks:** standard. Tests cover ingest from envelope, idempotent ingest (re-ingesting same envelope returns same transaction), transition validation, kill-switch from each non-terminal state, kill-switch rejected from terminal states.

---

## B4.2 — Authorization pipeline

**Purpose.** Run a sequence of checks on a transaction in `RECEIVED` state. Each check returns pass or structured rejection. Pipeline short-circuits on first rejection. Pass → transition to `AUTHORIZED`.

**Files to create.**
- `modules/authorization/checks/limits.js`
- `modules/authorization/checks/account-status.js`
- `modules/authorization/checks/sanctions.js`     (stub — Phase 6 fills)
- `modules/authorization/checks/fraud.js`         (stub — Phase 6 fills)
- `modules/authorization/checks/liquidity.js`     (stub — Phase 5 fills)
- `modules/authorization/checks/duplicates.js`
- `modules/authorization/pipeline.js`              (composes the checks)
- `modules/authorization/service.js`
- `modules/authorization/index.js`
- `modules/authorization/tests/authorization.test.js`

**No new migration.** No new routes (the authorization pipeline is internal — called by transactions service when ingesting). No standalone server.

**Each check signature:**

```js
// returns { pass: true } or { pass: false, code: 'AM04', message: '...' }
export const limitsCheck = ({ transaction, originatorAccount, beneficiaryAccount }) => { ... };
```

**Implemented checks (Phase 4):**

1. **`account-status`** — originator account must be `active`; beneficiary account must be `active` (resolved via `directory.findByAccount`); if alias used, alias must be `verified`. Codes returned: `AC01`/`AC04`/`AC06` per ISO mapping.
2. **`limits`** — per-participant daily and monthly caps (configurable per participant in `participants.metadata`). Default caps: daily GHS 1,000,000, monthly GHS 30,000,000 per participant per direction. Returns `AG01` if exceeded. Read total volume from `transactions` table for the relevant window.
3. **`duplicates`** — within last 7 days, no other transaction with same `(originator_participant, end_to_end_id)`. Returns `AM05` if found.

**Stub checks (return `{ pass: true }` always for Phase 4):**

4. **`sanctions`** — Phase 6 fills. Phase 4 returns pass with a comment that this is a stub. (No `// TODO` — that violates the rule. Use a JSDoc note that says "Phase 6 fills this in.")
5. **`fraud`** — same. Returns `{ pass: true, score: 0 }`.
6. **`liquidity`** — Phase 5 fills. Returns `{ pass: true }`.

**Pipeline order:** duplicates → account-status → sanctions → fraud → limits → liquidity. (Cheap checks first; liquidity last because it'll be the most expensive once Phase 5 lights up.)

**Service:** `authorize(client, transaction)` runs the pipeline, returns `{ ok: true }` or `{ ok: false, code, message }`. Caller in `transactions.service` handles the transition.

**Exit checks:** standard. Tests cover happy path, each rejection code, short-circuit on first rejection (subsequent checks not called), stub checks return pass.

---

## B4.3 — Response code taxonomy + `core/codes.js`

**Purpose.** The single canonical mapping from internal rail codes to ISO 20022 codes. Every adapter and every service uses this. Authorized addition to `core/`.

**Files to create.**
- `core/codes.js`
- `tests/codes.test.js`

**`core/codes.js` content (locked — copy verbatim):**

```js
// Rail-internal codes. Used in transactions.reason_code, response envelopes, audit events.
export const RAIL_CODES = Object.freeze({
  SUCCESS: 'SUCCESS',
  BENEFICIARY_ACCOUNT_NOT_FOUND: 'BENEFICIARY_ACCOUNT_NOT_FOUND',
  BENEFICIARY_ACCOUNT_CLOSED: 'BENEFICIARY_ACCOUNT_CLOSED',
  BENEFICIARY_ACCOUNT_BLOCKED: 'BENEFICIARY_ACCOUNT_BLOCKED',
  TRANSACTION_FORBIDDEN: 'TRANSACTION_FORBIDDEN',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  DUPLICATE: 'DUPLICATE',
  INVALID_END_CUSTOMER: 'INVALID_END_CUSTOMER',
  INVALID_DATE: 'INVALID_DATE',
  SETTLEMENT_FAILED: 'SETTLEMENT_FAILED',
  INVALID_FORMAT: 'INVALID_FORMAT',
  BENEFICIARY_DECEASED: 'BENEFICIARY_DECEASED',
  REGULATORY: 'REGULATORY',
  CUTOFF_TIME: 'CUTOFF_TIME',
  OPERATOR_KILL_SWITCH: 'OPERATOR_KILL_SWITCH',
  RAIL_INTERNAL_ERROR: 'RAIL_INTERNAL_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNREACHABLE: 'UNREACHABLE'
});

// Rail state → ISO 20022 transaction status code (used in pacs.002 TxSts).
export const STATE_TO_ISO_STATUS = Object.freeze({
  RECEIVED: 'RCVD',
  AUTHORIZED: 'ACTC',
  ROUTED: 'ACSP',
  CREDIT_LEG_PENDING: 'ACSP',
  CONFIRMED: 'ACSC',
  PENDING_RECONCILIATION: 'PDNG',
  REJECTED: 'RJCT',
  FAILED: 'RJCT',
  REVERSED: 'ACSC'
});

// Rail reason → ISO 20022 reason code (used in pacs.002 StsRsnInf/Rsn/Cd).
export const REASON_TO_ISO_REASON = Object.freeze({
  BENEFICIARY_ACCOUNT_NOT_FOUND: 'AC01',
  BENEFICIARY_ACCOUNT_CLOSED: 'AC04',
  BENEFICIARY_ACCOUNT_BLOCKED: 'AC06',
  TRANSACTION_FORBIDDEN: 'AG01',
  INSUFFICIENT_FUNDS: 'AM04',
  DUPLICATE: 'AM05',
  INVALID_END_CUSTOMER: 'BE01',
  INVALID_DATE: 'DT01',
  SETTLEMENT_FAILED: 'ED05',
  INVALID_FORMAT: 'FF01',
  BENEFICIARY_DECEASED: 'MD07',
  REGULATORY: 'RR04',
  CUTOFF_TIME: 'TM01',
  OPERATOR_KILL_SWITCH: 'RR04',
  RAIL_INTERNAL_ERROR: 'XT99',
  TIMEOUT: 'XT99',
  UNREACHABLE: 'XT99'
});

// Result categories for routing decisions (drives recovery vs. terminal).
export const CATEGORY = Object.freeze({
  TERMINAL_FAIL: 'TERMINAL_FAIL',     // beneficiary returned a final no
  RETRYABLE_FAIL: 'RETRYABLE_FAIL',   // transient — recovery may flip to confirmed
  AMBIGUOUS: 'AMBIGUOUS',             // timeout — recovery must check status
  TERMINAL_SUCCESS: 'TERMINAL_SUCCESS'
});

export const REASON_TO_CATEGORY = Object.freeze({
  BENEFICIARY_ACCOUNT_NOT_FOUND: 'TERMINAL_FAIL',
  BENEFICIARY_ACCOUNT_CLOSED: 'TERMINAL_FAIL',
  BENEFICIARY_ACCOUNT_BLOCKED: 'TERMINAL_FAIL',
  TRANSACTION_FORBIDDEN: 'TERMINAL_FAIL',
  INSUFFICIENT_FUNDS: 'TERMINAL_FAIL',
  DUPLICATE: 'TERMINAL_FAIL',
  INVALID_END_CUSTOMER: 'TERMINAL_FAIL',
  INVALID_DATE: 'TERMINAL_FAIL',
  SETTLEMENT_FAILED: 'RETRYABLE_FAIL',
  INVALID_FORMAT: 'TERMINAL_FAIL',
  BENEFICIARY_DECEASED: 'TERMINAL_FAIL',
  REGULATORY: 'TERMINAL_FAIL',
  CUTOFF_TIME: 'TERMINAL_FAIL',
  OPERATOR_KILL_SWITCH: 'TERMINAL_FAIL',
  RAIL_INTERNAL_ERROR: 'AMBIGUOUS',
  TIMEOUT: 'AMBIGUOUS',
  UNREACHABLE: 'AMBIGUOUS'
});

export const isoStatusFor = (state) => STATE_TO_ISO_STATUS[state];
export const isoReasonFor = (railReason) => REASON_TO_ISO_REASON[railReason] || 'XT99';
export const categoryFor = (railReason) => REASON_TO_CATEGORY[railReason] || 'AMBIGUOUS';
```

**Exit checks:** standard. Tests verify every code maps to an ISO code, every state maps to an ISO status, every reason has a category.

---

## B4.4 — `modules/routing/`

**Purpose.** Resolve any payment instruction's beneficiary to a participant and account. BIN tables (account number prefix → participant). Hot-reloadable. Integrates with directory/aliases for full resolution.

**Files to create.**
- `migrations/0014_routing.sql`
- `modules/routing/schema.js`
- `modules/routing/model.js`
- `modules/routing/cache.js`              (in-memory cache with version stamp; reload bumps stamp)
- `modules/routing/service.js`
- `modules/routing/controller.js`
- `modules/routing/routes.js`
- `modules/routing/server.js` (port 4302)
- `modules/routing/index.js`
- `modules/routing/tests/routing.test.js`

**`migrations/0014_routing.sql`:**

```sql
CREATE TABLE IF NOT EXISTS routing_rules (
  id                  UUID PRIMARY KEY,
  rule_type           TEXT NOT NULL,                -- 'BIN' | 'MSISDN_PREFIX' | 'BIC' | 'PARTICIPANT_CODE'
  pattern             TEXT NOT NULL,                -- e.g. '0123' for BIN, '024' for MSISDN, BANK02GHACXXX for BIC
  participant_code    TEXT NOT NULL REFERENCES participants(code),
  priority            INT NOT NULL DEFAULT 100,    -- lower = higher priority on conflict
  active              BOOLEAN NOT NULL DEFAULT true,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_type, pattern, participant_code)
);

CREATE INDEX IF NOT EXISTS routing_active_idx ON routing_rules(active, rule_type);
```

**Service API:**

```js
addRule({ ruleType, pattern, participantCode, priority, notes }) -> rule
removeRule(id) -> { removed: true }
listRules({ ruleType, participantCode, active }) -> rules[]
reload() -> { version, rulesCount }
resolve({ accountNumber, msisdn, bic, participantCode }) -> { participantCode, ruleId, ruleType } | null
```

**Cache:** in-memory map keyed by `(ruleType, longest-prefix-match)`. `reload()` rebuilds from DB. Cache has a `version` integer that bumps on each reload. Cross-cluster invalidation is out of scope for monolith but the version stamp is the foundation for it.

**Resolution order in `resolve`:**
1. If `participantCode` provided directly, return it (no rule lookup needed).
2. If `bic` provided, BIC rule lookup.
3. If `accountNumber` provided, longest-prefix BIN lookup.
4. If `msisdn` provided, longest-prefix MSISDN lookup (e.g. `024` → MTN).
5. Return null if no match.

**Routes:**
- `GET /routing/rules`
- `POST /routing/rules`         (admin)
- `DELETE /routing/rules/:id`   (admin)
- `POST /routing/reload`        (admin — bumps cache version)
- `POST /routing/resolve`       (internal — used by transactions service)

**Seed:** `scripts/seed.js` extends to add MSISDN prefix rules for the Ghana mobile money operators (MTN: 024, 054, 055, 059; Telecel: 020, 050; AirtelTigo: 026, 056, 027, 057) and BIN rules for the seeded demo banks.

**Exit checks:** standard. Tests cover BIN longest-prefix, MSISDN longest-prefix, hot reload (rule add → resolve sees old, reload → sees new).

---

## B4.5 — Multi-rail orchestration (rail-class registry)

**Purpose.** Decide which rail-class a transaction takes. Phase 4 ships the framework with one fully-implemented class (`DOMESTIC_INSTANT`); other classes are registered but stub their per-class behavior to delegate to DOMESTIC_INSTANT for now. Phase 8 fills `DOMESTIC_BATCH`. Phase 9 fills `FOREIGN`.

**Files to create.**
- `modules/rail-orchestration/classes/domestic-instant.js`
- `modules/rail-orchestration/classes/domestic-batch.js`           (stub: delegates to instant)
- `modules/rail-orchestration/classes/mobile-money-interop.js`     (stub: delegates to instant)
- `modules/rail-orchestration/classes/foreign.js`                  (stub: delegates to instant)
- `modules/rail-orchestration/registry.js`
- `modules/rail-orchestration/service.js`
- `modules/rail-orchestration/index.js`
- `modules/rail-orchestration/tests/orchestration.test.js`

No new migration. No HTTP routes (used internally by transactions service).

**Each rail class exports:**

```js
export const railClass = {
  name: 'DOMESTIC_INSTANT',
  timeoutMs: 10000,
  retryPolicyName: 'aggressive',  // see recovery worker
  classify: ({ originator, beneficiary }) => true | false,  // does this txn belong to this class?
  prepare: async (client, transaction) => { ... },           // any pre-credit-leg setup
  // credit-leg call itself is in modules/credit-leg/, parameterized by class
};
```

**`registry.js`** holds the four classes. `chooseClassFor(envelope)` runs `classify` on each in priority order and returns the first match. `DOMESTIC_INSTANT` priority 1 matches if both originator and beneficiary participants have `country_code = 'GH'` and either is a BANK or WALLET. `MOBILE_MONEY_INTEROP` priority 2 matches if either side is a WALLET. `FOREIGN` priority 3 matches if originator and beneficiary have different country_codes. `DOMESTIC_BATCH` priority 99 (only if explicitly set on envelope metadata).

**Service:** `orchestrate(client, transaction, envelope)` chooses class, sets `transactions.rail_class`, runs `prepare`, returns the chosen class.

**Exit checks:** standard. Tests cover each classify rule, fallthrough order, prepare hook called.

---

## B4.6 — Credit leg + participant simulator

**Purpose.** The actual outbound call from the rail to the beneficiary participant. Plus the in-rail simulator that lets us test without real participants connected.

**Files to create.**
- `migrations/0015_simulator_rules.sql`
- `modules/participant-simulator/schema.js`
- `modules/participant-simulator/rules.js`         (force-account behavior table)
- `modules/participant-simulator/service.js`
- `modules/participant-simulator/controller.js`
- `modules/participant-simulator/routes.js`        (`/simulator/:participantCode/credit-leg`, `/status-check`, `/reversal`)
- `modules/participant-simulator/server.js` (port 4303)
- `modules/participant-simulator/index.js`
- `modules/participant-simulator/tests/simulator.test.js`
- `modules/credit-leg/service.js`                  (HTTP client to participant.endpoints.credit_leg)
- `modules/credit-leg/timeout.js`                  (Promise.race timeout helper, local — not core)
- `modules/credit-leg/controller.js`
- `modules/credit-leg/routes.js`                   (`POST /credit-leg/run/:transactionId` — internal, mostly for testing)
- `modules/credit-leg/server.js` (port 4304)
- `modules/credit-leg/index.js`
- `modules/credit-leg/tests/credit-leg.test.js`

**Simulator rules (locked, see force-behavior table at top of doc).** Account number 9999000001-9999000010 have specific behaviors. All others succeed.

**`migrations/0015_simulator_rules.sql`:**

```sql
CREATE TABLE IF NOT EXISTS simulator_overrides (
  id                  UUID PRIMARY KEY,
  participant_code    TEXT NOT NULL,
  account_number      TEXT NOT NULL,
  behavior            TEXT NOT NULL,                -- 'SUCCESS' | 'REJECT_AM04' | 'TIMEOUT' | etc.
  reason_code         TEXT,
  delay_ms            INT NOT NULL DEFAULT 50,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_code, account_number)
);
```

The hardcoded rules in `rules.js` (the force-account table) take precedence over `simulator_overrides`. Overrides let operators inject specific behavior for testing edge cases per participant.

**Credit-leg HTTP call:**
- `service.run(client, transaction)`:
  1. Look up beneficiary participant's `endpoints.credit_leg`
  2. Build the canonical credit-leg payload (see locked contract above)
  3. Sign with rail's active Ed25519 key
  4. POST with 10s timeout
  5. Parse response — either `{ok: true, responseCode: 'ACSC', creditedAt}` or `{ok: false, error: {code, message}}` or timeout
  6. Return `{ category: TERMINAL_SUCCESS | TERMINAL_FAIL | RETRYABLE_FAIL | AMBIGUOUS, reasonCode, raw }`

**Timeout helper** (`modules/credit-leg/timeout.js`):

```js
export const withTimeout = (promise, ms, onTimeout) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(onTimeout()), ms))
  ]);
```

The simulator's slow-response (account 9999000008) tests this — responds at ~7s, rail's 10s ceiling holds. Account 9999000007 doesn't respond, hits the 10s limit cleanly.

**Exit checks:** standard. Tests cover each force-behavior account → expected category. Real timeout test using the `9999000007` and `9999000008` accounts (both with shorter test-mode timeouts to keep test runtime sane).

---

## B4.7 — Atomic outcome (orchestrate the full flow)

**Purpose.** Wire transactions service to authorization, routing, rail orchestration, and credit-leg into a single end-to-end function: `processTransaction(envelope)`. Inside one outermost `withTransaction`, run the whole flow. On any unexpected error, ensure transaction reaches a terminal state (REJECTED with `RAIL_INTERNAL_ERROR`).

**Files to create.**
- `modules/transactions/orchestrator.js`
- (extends existing `modules/transactions/service.js` with `process` method — the existing tests stay green)
- `modules/transactions/tests/orchestrator.test.js`

**Orchestration sequence:**

```js
processTransaction(envelope) {
  return withTransaction(async (c) => {
    // 1. Ingest (idempotent)
    let tx = await ingestFromEnvelope(c, envelope);
    if (isTerminal(tx.state)) return tx;  // already done — return as-is

    // 2. Authorize
    const authResult = await authorize(c, tx);
    if (!authResult.ok) {
      return await transition(c, tx.id, 'REJECTED', { reasonCode: authResult.code, ...});
    }
    tx = await transition(c, tx.id, 'AUTHORIZED', { occurredBy: 'system' });

    // 3. Route
    const routeResult = await route(c, tx, envelope);
    if (!routeResult.ok) {
      return await transition(c, tx.id, 'REJECTED', { reasonCode: routeResult.code });
    }
    tx = await transition(c, tx.id, 'ROUTED', { ... });

    // 4. Orchestrate rail class
    const railClass = await orchestrate(c, tx, envelope);

    // 5. Credit leg
    tx = await transition(c, tx.id, 'CREDIT_LEG_PENDING', { ... });
    const cl = await runCreditLeg(c, tx);

    // 6. Atomic outcome
    if (cl.category === 'TERMINAL_SUCCESS') {
      return await transition(c, tx.id, 'CONFIRMED', { responseCode: 'ACSC' });
    }
    if (cl.category === 'TERMINAL_FAIL') {
      return await transition(c, tx.id, 'REJECTED', { reasonCode: cl.reasonCode });
    }
    // AMBIGUOUS or RETRYABLE_FAIL — recovery takes over
    return await transition(c, tx.id, 'PENDING_RECONCILIATION', { reasonCode: cl.reasonCode });
  });
}
```

**Exit checks:** standard. Tests cover happy path (RECEIVED → CONFIRMED), each failure path producing the right terminal state, idempotent re-call returns existing terminal transaction, internal error catches and transitions to REJECTED with RAIL_INTERNAL_ERROR.

---

## B4.8 — Recovery worker

**Purpose.** Background worker that processes `PENDING_RECONCILIATION` transactions. Calls participant status-check, retries with exponential backoff, eventually transitions to terminal state. If retries exhaust and credit may have been applied, triggers automatic reversal (B4.10).

**Files to create.**
- `modules/transaction-recovery/policy.js`        (retry policies named: 'aggressive', 'standard', 'conservative')
- `modules/transaction-recovery/service.js`
- `modules/transaction-recovery/worker.js`        (the actual loop, started by the monolith)
- `modules/transaction-recovery/index.js`
- `modules/transaction-recovery/tests/recovery.test.js`

No new migration. No new routes (worker is internal).

**Retry policy — `aggressive` for DOMESTIC_INSTANT:**
- Initial wait: 2 seconds
- Max attempts: 5
- Backoff: 2s, 4s, 8s, 16s, 32s (capped)
- Total window: ~62 seconds
- After exhaust: if any status-check returned `pending` or `not_credited` → REJECTED. If any returned `credited` → CONFIRMED. If all returned `not_found` → FAILED + auto-reversal triggered (because credit may have been applied; participant just has no record).

**Worker loop:**
- Poll every 1 second
- `SELECT … FROM transactions WHERE state = 'PENDING_RECONCILIATION' AND next_attempt_at <= now() FOR UPDATE SKIP LOCKED LIMIT 10`
- For each, call status-check at participant
- Update attempt count + `next_attempt_at` in **separate connection** (per the counter-durability rule from CLAUDE.md)
- Apply policy

**Schema additions:** add `next_attempt_at TIMESTAMPTZ`, `attempts INT DEFAULT 0` columns to `transactions` via `migrations/0016_transactions_recovery.sql`.

**Exit checks:** standard. Tests cover:
- TIMEOUT → recovery confirms credited via status-check → CONFIRMED
- TIMEOUT → recovery confirms not_credited → REJECTED
- TIMEOUT → all status-checks fail/not_found → FAILED + reversal triggered
- Counter durability: forced status-check failure mid-sequence still increments attempts

---

## B4.9 — Confirmation flow + receipts

**Purpose.** When a transaction reaches `CONFIRMED`, the rail signs receipts for both originator and beneficiary participants. They can fetch their receipts. Receipts are cryptographic proof of completion and are used in disputes (Phase 7).

**Files to create.**
- `migrations/0017_transaction_receipts.sql`
- `modules/transaction-receipts/schema.js`
- `modules/transaction-receipts/model.js`
- `modules/transaction-receipts/service.js`
- `modules/transaction-receipts/controller.js`
- `modules/transaction-receipts/routes.js`
- `modules/transaction-receipts/server.js` (port 4305)
- `modules/transaction-receipts/index.js`
- `modules/transaction-receipts/tests/receipts.test.js`

**`migrations/0017_transaction_receipts.sql`:**

```sql
CREATE TABLE IF NOT EXISTS transaction_receipts (
  id                  UUID PRIMARY KEY,
  transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  party               TEXT NOT NULL,                  -- 'ORIGINATOR' | 'BENEFICIARY'
  participant_code    TEXT NOT NULL,
  receipt_payload     JSONB NOT NULL,
  signature_b64       TEXT NOT NULL,
  signature_kid       TEXT NOT NULL,
  signature_alg       TEXT NOT NULL DEFAULT 'Ed25519',
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, party)
);

CREATE INDEX IF NOT EXISTS receipts_participant_idx ON transaction_receipts(participant_code);
```

**Receipt payload (canonical JSON, signed by rail):**

```json
{
  "transactionId": "uuid",
  "envelopeId": "uuid",
  "endToEndId": "...",
  "amount": { "value": "15000", "currency": "GHS" },
  "originatorParticipant": "BANK01",
  "beneficiaryParticipant": "BANK02",
  "responseCode": "ACSC",
  "confirmedAt": "...",
  "issuedAt": "...",
  "party": "ORIGINATOR" | "BENEFICIARY"
}
```

Signed via `cryptoKeys.sign({ kid: railKid, payload: canonicalJsonBytes(receipt) })`. Verifiable by anyone with the rail's public key.

**Service trigger:** the orchestrator (`modules/transactions/orchestrator.js`) calls `issueReceipts(c, tx)` upon CONFIRMED transition. Done inside the same outer transaction so it's atomic with the state change.

**Routes:**
- `GET /transaction-receipts/by-transaction/:txId` — returns both receipts (auth required)
- `GET /transaction-receipts/verify` — body `{ payload, signature, kid }` — public verification endpoint

**Exit checks:** standard. Tests cover receipt issued atomically with CONFIRMED transition, verification roundtrip, two receipts per transaction (one per party).

---

## B4.10 — `modules/reversals/`

**Purpose.** Linked unwinds of completed transactions. A reversal is itself a transaction (referencing the original via `original_transaction_id`). Triggered automatically by the recovery worker (FAILED case) or manually by an authorized operator. Goes through its own credit-leg (in opposite direction).

**Files to create.**
- `modules/reversals/schema.js`
- `modules/reversals/service.js`
- `modules/reversals/controller.js`
- `modules/reversals/routes.js`
- `modules/reversals/server.js` (port 4306)
- `modules/reversals/index.js`
- `modules/reversals/tests/reversals.test.js`

No new migration — uses existing `transactions` table with `original_transaction_id` link.

**Reversal reason codes (locked):**
- `DUPL` — Duplicate payment
- `FRAD` — Fraudulent transaction (Phase 6 will fully integrate)
- `TECH` — Technical error / wrong execution
- `CUST` — Customer requested
- `RGLT` — Regulatory direction
- `RECON_FAILED` — Recovery worker concluded credit may have been applied but participant has no record

**Service API:**

```js
initiate(client, { originalTxId, reasonCode, initiatedBy }) -> reversalTransaction
listForOriginal(client, originalTxId) -> reversals[]
```

`initiate` validates the original is in `CONFIRMED`, creates a new transaction with reversed originator/beneficiary, `original_transaction_id = originalTxId`, runs the orchestrator (auth pipeline checks, routes, calls participant's reversal endpoint instead of credit_leg). On reversal completion, transitions the original from `CONFIRMED` → `REVERSED`.

**Routes:**
- `POST /reversals` — body `{ originalTxId, reasonCode }` — admin only
- `GET /reversals/:id` — fetch
- `GET /reversals/by-original/:originalTxId` — list

**Exit checks:** standard. Tests cover happy reversal, reversal of non-CONFIRMED rejected, reversal called by recovery on FAILED-with-possibly-credited, double-reversal rejected (CONFIRMED → REVERSED is the only path).

---

## B4.11 — End-to-end demo: REST domestic P2P

**Purpose.** First fully-working end-to-end script. Two participants, real accounts, real credit leg via simulator, real receipts. Proves the rail does what it says.

**Files to create.**
- `scripts/demo-phase-4-rest.sh`
- `tests/phase-4-e2e.test.js`

**`scripts/demo-phase-4-rest.sh`:**

```bash
#!/usr/bin/env bash
set -e
pnpm reset
pnpm migrate
pnpm seed                                    # seeds 3 demo participants + 6 accounts + simulator URLs + force accounts under BANK_TEST
pnpm vitest run
pnpm lint
pnpm check-boundaries

node server.js &
SERVER_PID=$!
for i in $(seq 1 30); do curl -sf http://localhost:3000/health > /dev/null && break; sleep 0.2; done

# Login as admin
curl -sf -c /tmp/c -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}'

# 1. Happy path — KOFI (BANK01 0123000001) pays AMA (BANK02 0234000001) GHS 150
RESP=$(curl -sf -b /tmp/c -X POST http://localhost:3000/adapters-rest/inbound \
  -H 'content-type: application/json' \
  -d @scripts/fixtures/p4-happy.json)
TXID=$(echo "$RESP" | jq -r '.data.transactionId')
test "$(echo "$RESP" | jq -r '.data.state')" = "CONFIRMED"

# Verify receipts exist for both parties
curl -sf -b /tmp/c http://localhost:3000/transaction-receipts/by-transaction/$TXID | jq -e '.data | length == 2'

# 2. Insufficient funds — pay to 9999000002
RESP=$(curl -sf -b /tmp/c -X POST http://localhost:3000/adapters-rest/inbound \
  -H 'content-type: application/json' \
  -d @scripts/fixtures/p4-insufficient.json)
test "$(echo "$RESP" | jq -r '.data.state')" = "REJECTED"
test "$(echo "$RESP" | jq -r '.data.reasonCode')" = "INSUFFICIENT_FUNDS"

# 3. Timeout → recovery → eventually FAILED — pay to 9999000007
RESP=$(curl -sf -b /tmp/c -X POST http://localhost:3000/adapters-rest/inbound \
  -H 'content-type: application/json' \
  -d @scripts/fixtures/p4-timeout.json)
TXID2=$(echo "$RESP" | jq -r '.data.transactionId')
# Allow up to 70s for recovery to exhaust retries
for i in $(seq 1 35); do
  STATE=$(curl -sf -b /tmp/c http://localhost:3000/transactions/$TXID2 | jq -r '.data.state')
  if [ "$STATE" = "FAILED" ] || [ "$STATE" = "REJECTED" ]; then break; fi
  sleep 2
done
test "$STATE" = "FAILED" -o "$STATE" = "REJECTED"

# 4. Manual reversal of the happy-path transaction
curl -sf -b /tmp/c -X POST http://localhost:3000/reversals \
  -H 'content-type: application/json' \
  -d "{\"originalTxId\":\"$TXID\",\"reasonCode\":\"CUST\"}"
sleep 2
test "$(curl -sf -b /tmp/c http://localhost:3000/transactions/$TXID | jq -r '.data.state')" = "REVERSED"

# 5. Idempotency — re-post the happy-path envelope, expect same transaction returned
RESP2=$(curl -sf -b /tmp/c -X POST http://localhost:3000/adapters-rest/inbound \
  -H 'content-type: application/json' \
  -d @scripts/fixtures/p4-happy.json)
test "$(echo "$RESP2" | jq -r '.data.transactionId')" = "$TXID"

kill $SERVER_PID
wait $SERVER_PID 2>/dev/null || true
echo "PHASE 4 REST DEMO OK"
```

Fixtures `scripts/fixtures/p4-happy.json`, `p4-insufficient.json`, `p4-timeout.json` are canonical envelopes targeting the relevant accounts.

**Exit checks:** standard. The demo script must run cleanly start-to-finish.

---

## B4.12 — Phase 4 exit gate: ISO 8583 + ISO 20022 demos

**Purpose.** Prove the rail is format-agnostic. Same flows, different wire formats. Phase 2's adapters meet Phase 4's lifecycle.

**Files to create.**
- `scripts/demo-phase-4-iso20022.sh`
- `scripts/demo-phase-4-iso8583.sh`
- `scripts/demo-phase-4.sh`            (orchestrator that runs all three sub-demos)
- `scripts/fixtures/p4-happy.pacs008.xml`
- `scripts/fixtures/p4-insufficient.pacs008.xml`
- `scripts/fixtures/p4-happy.0200.bin`
- `scripts/fixtures/p4-insufficient.0200.bin`
- `tests/phase-4-format-parity.test.js`

**`scripts/demo-phase-4.sh`** runs:
1. `bash scripts/demo-phase-4-rest.sh`
2. `bash scripts/demo-phase-4-iso20022.sh` — same scenarios via pacs.008 XML, expects matching outcomes
3. `bash scripts/demo-phase-4-iso8583.sh` — same scenarios via 0200 binary, expects matching outcomes
4. Print `PHASE 4 OK`

**Phase 4 exit gate (paste output):**
- `bash scripts/demo-phase-4.sh` — prints `PHASE 4 OK`
- `pnpm vitest run` — all green; expect ~480+ total
- `pnpm lint` — clean
- `pnpm check-boundaries` — clean
- `pnpm reset && pnpm migrate && pnpm seed` — 17 migrations apply clean from empty DB
- `git log --oneline | head -40` — shows 12 phase-4 commits

When this passes, Phase 4 is done. Stop. Wait for "continue to Phase 5."

---

## What "PHASE 4 OK" unlocks

After Phase 4 ships:
- A real payment moves end-to-end through the rail in any of three wire formats.
- Idempotency works at envelope and transaction level.
- The state machine is locked and audit-logged.
- Force-fail accounts let any developer test edge cases deterministically — same UPI/PIX sandbox pattern.
- The participant HTTP contract is the canonical reference any real bank can implement against.
- Recovery handles timeouts and ambiguous outcomes without operator intervention.
- Receipts are cryptographic proof of completion (used heavily in Phase 7 disputes).
- Reversals are linked unwinds with structured reason codes.
- Phase 5 (settlement & ledger) plugs in at the `CONFIRMED` transition. Phase 6 (fraud) plugs in at the authorization pipeline. Phase 7 (disputes) plugs in at receipts and reversals.
