# PHASE 5 — Settlement, Liquidity & EOD

**Mode:** Autonomous. Single master prompt, no per-block sign-off.

**Goal at end of phase:**
- Every confirmed transaction posts to a double-entry, hash-chained ledger atomically with the `CONFIRMED` state transition.
- Every participant has real-time settlement positions visible to ops.
- Liquidity floors and ceilings throttle/block participants approaching their limits.
- Settlement cycles run intraday (every N hours) and at end-of-day, netting positions and instructing the operator's RTGS account at the central bank to move money between participants.
- A defined day-cutover ("EOD") cleanly closes the day's books, generates signed settlement statements per participant, freezes them with a daily hash chain, and rolls into the next operating day without downtime.
- Continuous reconciliation flags any drift between the rail's ledger and a participant's books before EOD.
- Fees accrue at authorization and settle in the same cycle as the underlying transaction.

**Why this is the next-most architecturally critical phase after Phase 4.** Phase 4 made the rail move payments. Phase 5 makes the rail handle money correctly. Get the ledger wrong here and every later phase compounds the error.

---

## What's in scope, what isn't

**In scope (Phase 5):**
- Double-entry hash-chained ledger
- Per-participant real-time settlement position (a running net obligation, NOT a real account balance)
- Liquidity floors/ceilings, prefunding, throttle/block on breach
- Settlement cycle engine (intraday + EOD)
- Operator's RTGS movement instructions (file-based output for now — actual BoG RTGS integration is a Phase 10 deferred item)
- EOD cutover with day rollover and frozen statement issuance
- Continuous reconciliation harness with stub-able participant feeds
- Fee schedules per transaction class, accrual at authorization, netting at settlement

**NOT in scope (deferred to later phases):**
- Real BoG RTGS integration (the file output we generate is the integration point)
- Cross-border settlement → Phase 9 (covers PvP atomic, multi-currency)
- Real participant ledger feeds for recon → Phase 10 (covers webhook/polling integrations)
- Disputes affecting settlement → Phase 7 (will plug into the reversal flow that's already wired)

---

## Architectural shape

```
                ┌─────────────────────────────────────────┐
                │              ledger                      │
                │   (double-entry, hash-chained, immutable)│
                └────────┬─────────────────┬────────────────┘
                         │                 │
              writes on  │                 │ reads from
              CONFIRMED  │                 │ on settlement cycle
                         ▼                 ▼
              ┌──────────────────┐  ┌────────────────────┐
              │  settlement       │  │   reconciliation    │
              │  (positions +     │  │   (continuous +    │
              │   cycles)         │  │    EOD)             │
              └────────┬──────────┘  └────────────────────┘
                       │
              ┌────────▼──────────┐
              │   liquidity        │
              │   (floors/ceilings,│
              │    throttle/block) │
              └────────────────────┘

              ┌────────────────────┐
              │       fees          │
              │  (accrue/net)      │
              └────────────────────┘

              ┌────────────────────┐
              │       eod           │
              │  (cutover + freeze │
              │   + statements)    │
              └────────────────────┘
```

---

## Locked: ledger account model

The ledger has these account types. CC must not invent more.

| Account type | Owner | Purpose |
|---|---|---|
| `PARTICIPANT_SETTLEMENT` | participant | Running obligation between this participant and the rail. Debit = participant owes rail. Credit = rail owes participant. |
| `RAIL_FEE_REVENUE` | rail | Fee accrual. Every transaction's fee credits this. |
| `RAIL_FEE_RECEIVABLE` | rail | Fees owed by participants, settled at next cycle. |
| `RAIL_SUSPENSE` | rail | Temporary holding for ambiguous-credit recovery cases (`PENDING_RECONCILIATION`). |
| `RAIL_REVERSAL` | rail | Linked to `RAIL_SUSPENSE` for unwinds. |
| `OPERATOR_RTGS_NOSTRO` | rail | The rail's account at BoG. Settlement cycles move money between participants by debiting/crediting this and the participant's mirror at BoG. |
| `RAIL_DISPUTE_RESERVE` | rail | Held funds awaiting dispute outcome. Phase 7 lights this up. |

Every transaction's confirmed credit posts at minimum a 2-leg entry:

```
DR PARTICIPANT_SETTLEMENT(originator)   amount + fee
CR PARTICIPANT_SETTLEMENT(beneficiary)  amount
CR RAIL_FEE_REVENUE                     fee
```

Reversals post the inverse with a structured link to the original entry.

---

## Locked: settlement cycle taxonomy

Cycles are runs of net-position resolution. CC must not invent more cycle types.

| Cycle type | Frequency | Behavior |
|---|---|---|
| `INTRADAY_NET` | Every N hours (configurable, default 4h) | Net all positions since last cycle. Generate RTGS movement file. Reset positions to zero post-cycle. |
| `END_OF_DAY` | Once per operating day at the configured cutover time | Same as `INTRADAY_NET` plus: snapshot day, generate signed statements, freeze with hash chain, roll calendar day. |
| `RTGS_GROSS` | On-demand for high-value transactions | Settles a single transaction directly through OPERATOR_RTGS_NOSTRO without netting. Originator must opt in via envelope metadata. |
| `EXCEPTION` | On-demand, operator-triggered | Used to force a settlement run outside normal cycles (e.g. before a regulator inspection, or to clear a backlog after extended outage). Audit-heavy. |

---

## Locked: operating day model

The rail has a **continuous calendar** but a **discrete operating day**. Transactions never stop. The operating day has a defined start (00:00:01 in `OPERATOR_TIMEZONE`, default `Africa/Accra`) and a configured cutover time (default 23:00 local, configurable). `EOD` runs at cutover; the next operating day's books open simultaneously. There is no downtime.

Operating-day identity:
- `operating_date` (DATE) — `2026-04-27`
- `operating_day_id` (UUID) — assigned at day-open, used as foreign key from cycle runs and statements
- `state` — `OPEN` | `CLOSING` | `CLOSED` (irreversible after `CLOSED`)

Transactions retain `operating_date` from the moment they're authorized (set at the `AUTHORIZED` transition in Phase 4 — Phase 5 will retroactively populate this column on existing rows during migration).

---

## B5.1 — `modules/ledger/`

**Purpose.** The double-entry, hash-chained, immutable ledger. Every money movement on the rail's books goes through here. Function signatures enforce double-entry — there is no "post a single side" API.

**Files to create.**
- `migrations/0018_ledger.sql`
- `modules/ledger/schema.js`
- `modules/ledger/codes.js` — locked account-type constants
- `modules/ledger/model.js`
- `modules/ledger/service.js`
- `modules/ledger/controller.js`
- `modules/ledger/routes.js`
- `modules/ledger/server.js` (port 4401, key `ledgerPort`)
- `modules/ledger/index.js`
- `modules/ledger/tests/ledger.test.js`

**`migrations/0018_ledger.sql`:**

```sql
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id                  UUID PRIMARY KEY,
  account_code        TEXT UNIQUE NOT NULL,        -- 'PSET:BANK01:GHS', 'RAIL_FEE_REVENUE:GHS'
  account_type        TEXT NOT NULL,               -- locked enum from codes.js
  owner_type          TEXT NOT NULL,               -- 'PARTICIPANT' | 'RAIL'
  owner_id            TEXT,                        -- participant code, or null for rail
  currency            CHAR(3) NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_accounts_owner_idx ON ledger_accounts(owner_type, owner_id, currency);
CREATE INDEX IF NOT EXISTS ledger_accounts_type_idx ON ledger_accounts(account_type);

CREATE TABLE IF NOT EXISTS ledger_journal (
  id                  UUID PRIMARY KEY,
  journal_seq         BIGSERIAL UNIQUE,
  posted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  operating_date      DATE NOT NULL,
  reason              TEXT NOT NULL,                -- 'TRANSACTION_CONFIRMED' | 'REVERSAL' | 'FEE_SETTLE' | 'INTRADAY_CYCLE' | 'EOD_CYCLE'
  reference_type      TEXT,                          -- 'transaction' | 'cycle' | 'statement'
  reference_id        TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash           TEXT NOT NULL,
  hash                TEXT NOT NULL                  -- sha256(prev_hash || sha256(journal_payload))
);

CREATE INDEX IF NOT EXISTS ledger_journal_date_idx ON ledger_journal(operating_date);
CREATE INDEX IF NOT EXISTS ledger_journal_reason_idx ON ledger_journal(reason);
CREATE INDEX IF NOT EXISTS ledger_journal_ref_idx ON ledger_journal(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS ledger_postings (
  id                  UUID PRIMARY KEY,
  journal_id          UUID NOT NULL REFERENCES ledger_journal(id) ON DELETE RESTRICT,
  posting_seq         INT NOT NULL,                  -- 0,1,2,... within journal
  account_code        TEXT NOT NULL REFERENCES ledger_accounts(account_code),
  side                CHAR(2) NOT NULL,              -- 'DR' | 'CR'
  amount_value        NUMERIC(38,0) NOT NULL,
  currency            CHAR(3) NOT NULL,
  UNIQUE (journal_id, posting_seq)
);

CREATE INDEX IF NOT EXISTS ledger_postings_account_idx ON ledger_postings(account_code);
CREATE INDEX IF NOT EXISTS ledger_postings_journal_idx ON ledger_postings(journal_id);
```

**`codes.js` (locked, copy verbatim):**

```js
export const ACCOUNT_TYPES = Object.freeze({
  PARTICIPANT_SETTLEMENT:    'PARTICIPANT_SETTLEMENT',
  RAIL_FEE_REVENUE:          'RAIL_FEE_REVENUE',
  RAIL_FEE_RECEIVABLE:       'RAIL_FEE_RECEIVABLE',
  RAIL_SUSPENSE:             'RAIL_SUSPENSE',
  RAIL_REVERSAL:             'RAIL_REVERSAL',
  OPERATOR_RTGS_NOSTRO:      'OPERATOR_RTGS_NOSTRO',
  RAIL_DISPUTE_RESERVE:      'RAIL_DISPUTE_RESERVE'
});

export const JOURNAL_REASONS = Object.freeze({
  TRANSACTION_CONFIRMED: 'TRANSACTION_CONFIRMED',
  REVERSAL:              'REVERSAL',
  FEE_SETTLE:            'FEE_SETTLE',
  INTRADAY_CYCLE:        'INTRADAY_CYCLE',
  EOD_CYCLE:             'EOD_CYCLE',
  RTGS_GROSS:            'RTGS_GROSS',
  EXCEPTION:             'EXCEPTION'
});

export const accountCodeFor = ({ accountType, ownerId, currency }) => {
  // PSET:BANK01:GHS, RAIL_FEE_REVENUE:GHS, OPERATOR_RTGS_NOSTRO:GHS, etc.
  const prefix = accountType === 'PARTICIPANT_SETTLEMENT' ? `PSET:${ownerId}` : accountType;
  return `${prefix}:${currency}`;
};
```

**Service API (function signatures enforce rules):**

```js
// The ONLY way to write to the ledger.
// `entries` must have at least 2 postings, must balance per currency, and must be non-empty.
postJournal(client, {
  reason,                    // from JOURNAL_REASONS
  referenceType, referenceId,
  operatingDate,
  entries: [
    { accountCode, side: 'DR' | 'CR', amount: BigInt, currency }
  ],
  metadata
}) -> { journalId, hash }

// Read-only.
balanceFor(accountCode, { asOf }) -> BigInt
journalById(journalId) -> { journal, postings[] }
journalsByReference(referenceType, referenceId) -> journal[]
listAccounts({ ownerType, ownerId, currency }) -> accounts[]
ensureAccount({ accountType, ownerId, currency }) -> account     // idempotent
verifyDayChain(operatingDate) -> { ok: true } | { ok: false, brokenAtSeq }
```

**`postJournal` must:**
1. Reject if `entries.length < 2`.
2. Reject if any currency's `sum(DR) !== sum(CR)`.
3. Reject if any account doesn't exist.
4. Reject if any account is not `active`.
5. Compute `prev_hash` from the previous journal in the same `operating_date` (or `0x00...` for the first journal of the day).
6. Compute `hash = chainHash(prev_hash, canonicalJsonBytes(payload))` where payload includes `journal_seq`, `reason`, all postings sorted by `posting_seq`.
7. Insert journal + postings in caller's transaction.
8. Write audit event `ledger.journal_posted`.

**Phase 4 retroactive integration.** `transactions/orchestrator.js` and `transaction-recovery/service.js` (the two CONFIRMED-transition sites) get a new step: after the state transition, call `ledger.postJournal` with the standard 3-leg entry. This is done **inside the same `withTransaction`** as the state transition. If the ledger post fails, the entire transaction rolls back — including the state transition. The `transaction-receipts.issueReceipts` call moves to *after* the ledger post in the same transaction.

**Order locked:** state transition → ledger post → receipt issuance. All atomic.

**Routes:**
- `GET /ledger/accounts` — list (admin)
- `GET /ledger/accounts/:code/balance` — current balance
- `GET /ledger/journals/:id` — journal + postings
- `POST /ledger/journals` — admin only, used for manual adjustments via `EXCEPTION` reason
- `GET /ledger/verify/:date` — verify day's hash chain

**Exit checks:** standard. Tests:
- Reject single-sided post (only 1 entry)
- Reject unbalanced (DR ≠ CR)
- Reject mixed currencies that don't each balance individually
- Hash chain links across multiple journals same day
- Retroactive Phase 4 integration: a `processTransaction` happy path now also produces a journal entry; the journal balances; `participant settlement` balances reflect the move
- Rollback test: forced ledger post failure rolls back the state transition

---

## B5.2 — `modules/settlement/` (real-time positions)

**Purpose.** A read-optimized derived view of each participant's net obligation since the last settlement cycle. Reads from `ledger_postings` + `settlement_cycles`. Updated every transaction via a write-through cache.

**Files to create.**
- `migrations/0019_settlement_positions.sql`
- `modules/settlement/schema.js`
- `modules/settlement/positions-model.js`
- `modules/settlement/positions-service.js`
- `modules/settlement/controller.js`
- `modules/settlement/routes.js`
- `modules/settlement/server.js` (port 4402)
- `modules/settlement/index.js`
- `modules/settlement/tests/positions.test.js`

**`migrations/0019_settlement_positions.sql`:**

```sql
CREATE TABLE IF NOT EXISTS settlement_positions (
  id                  UUID PRIMARY KEY,
  participant_code    TEXT NOT NULL REFERENCES participants(code) ON DELETE RESTRICT,
  currency            CHAR(3) NOT NULL,
  position_minor      NUMERIC(38,0) NOT NULL DEFAULT 0,   -- positive = participant owes rail, negative = rail owes participant
  last_journal_id     UUID,
  last_cycle_id       UUID,                                -- last cycle this position was reset by
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_code, currency)
);

CREATE INDEX IF NOT EXISTS settlement_positions_currency_idx ON settlement_positions(currency);
```

**Service API:**

```js
applyJournalToPositions(client, journalId)        // called from ledger.postJournal in same txn
positionFor(participantCode, currency) -> { positionMinor, lastJournalId, lastCycleId, updatedAt }
listPositions({ currency }) -> positions[]
resetPositionsForCycle(client, cycleId, participantCodes, currency) -> count   // called by settlement-cycle
```

**`applyJournalToPositions`** is wired into `ledger.service.postJournal`: after a successful insert, the same transaction reads the postings and increments/decrements `settlement_positions.position_minor` for every `PARTICIPANT_SETTLEMENT` posting. The positions table is therefore a strictly-derived materialized view, and any breach between it and the journal is a recoverable bug (auto-reconcilable from the journal).

**Routes:**
- `GET /settlement/positions` — list with filters
- `GET /settlement/positions/:participantCode` — one participant
- `POST /settlement/positions/recompute` — admin only, full rebuild from journal (for break-glass)

**Exit checks:** standard. Tests:
- Single confirmed transaction moves both positions correctly
- Multiple transactions accumulate
- Recompute from journal produces identical balances
- Currency isolation (GHS and USD positions are separate rows)

---

## B5.3 — `modules/liquidity/`

**Purpose.** Each participant has a configured floor (minimum net position before throttling) and ceiling (maximum before blocking). The authorization pipeline (B4.2's `liquidity` check, currently a stub) wires up here. Top-up flow lets operators credit a participant's prefunded balance.

**Files to create.**
- `migrations/0020_liquidity.sql`
- `modules/liquidity/schema.js`
- `modules/liquidity/model.js`
- `modules/liquidity/service.js`
- `modules/liquidity/controller.js`
- `modules/liquidity/routes.js`
- `modules/liquidity/server.js` (port 4403)
- `modules/liquidity/index.js`
- `modules/liquidity/tests/liquidity.test.js`
- **Patch:** `modules/authorization/checks/liquidity.js` — replace the stub with the real check that calls `liquidityService.canDebit`.

**`migrations/0020_liquidity.sql`:**

```sql
CREATE TABLE IF NOT EXISTS liquidity_limits (
  id                  UUID PRIMARY KEY,
  participant_code    TEXT NOT NULL REFERENCES participants(code) ON DELETE RESTRICT,
  currency            CHAR(3) NOT NULL,
  prefunded_minor     NUMERIC(38,0) NOT NULL DEFAULT 0,    -- the prefunded balance at BoG
  floor_minor         NUMERIC(38,0) NOT NULL DEFAULT 0,    -- when net position approaches floor, throttle
  ceiling_minor       NUMERIC(38,0) NOT NULL,              -- absolute block limit
  throttle_threshold_pct  INT NOT NULL DEFAULT 80,         -- start throttling at 80% of ceiling
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_code, currency)
);

CREATE TABLE IF NOT EXISTS liquidity_topups (
  id                  UUID PRIMARY KEY,
  participant_code    TEXT NOT NULL REFERENCES participants(code),
  currency            CHAR(3) NOT NULL,
  amount_minor        NUMERIC(38,0) NOT NULL,
  reason              TEXT NOT NULL,
  applied_by          UUID NOT NULL REFERENCES users(id),
  applied_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  journal_id          UUID NOT NULL REFERENCES ledger_journal(id)
);

CREATE INDEX IF NOT EXISTS liquidity_topups_participant_idx ON liquidity_topups(participant_code, applied_at DESC);
```

**Service API:**

```js
configureLimits({ participantCode, currency, prefundedMinor, floorMinor, ceilingMinor, throttleThresholdPct })
applyTopUp({ participantCode, currency, amountMinor, reason, appliedBy })  // posts to ledger atomically
canDebit({ participantCode, currency, amountMinor }) -> { ok: true } | { ok: false, reason: 'INSUFFICIENT_LIQUIDITY' | 'THROTTLED', positionMinor, ceilingMinor }
listLimits({ currency }) -> limits[]
```

**Throttle behavior:** if the post-debit projected position would exceed `throttle_threshold_pct` of `ceiling_minor`, the rail returns the structured response (`AG01`) on a probabilistic basis (the higher above threshold, the higher the rejection rate). Hard ceiling = always block. This mirrors UPI/PIX's graduated throttling.

**`canDebit` algorithm:**
1. Read current position for participant + currency.
2. Compute projected: `position + amountMinor`.
3. If `projected >= ceiling_minor` → block with `INSUFFICIENT_LIQUIDITY`.
4. If `projected >= ceiling_minor * throttle_threshold_pct / 100` → throttle: reject with probability `(projected - threshold) / (ceiling - threshold)`.
5. Else → ok.

**Top-up posts a journal entry:**
```
DR OPERATOR_RTGS_NOSTRO       amount   (rail receives the prefunding from BoG)
CR PARTICIPANT_SETTLEMENT     amount   (positive credit to participant — rail owes them more)
```

**Routes:**
- `GET /liquidity/limits` — list
- `PUT /liquidity/limits/:participantCode/:currency` — configure
- `POST /liquidity/topup` — body `{participantCode, currency, amountMinor, reason}`
- `GET /liquidity/topups` — list

**Exit checks:** standard. Tests:
- Below threshold → all transactions pass
- Above threshold → graduated rejection (run 100 transactions, expect rejection rate matches probability)
- At ceiling → 100% rejection
- Top-up moves position correctly via ledger
- Patched authorization stub now uses real check

---

## B5.4 — `modules/settlement-cycle/` (intraday + EOD shared engine)

**Purpose.** Run a settlement cycle. Net all positions since the last cycle, generate the RTGS movement file, post the cycle journal entries, reset positions to zero. This is the engine that powers both intraday and EOD cycles — they differ only in trigger and side effects.

**Files to create.**
- `migrations/0021_settlement_cycles.sql`
- `modules/settlement-cycle/schema.js`
- `modules/settlement-cycle/model.js`
- `modules/settlement-cycle/service.js`
- `modules/settlement-cycle/cycle-runner.js` — the actual cycle engine
- `modules/settlement-cycle/rtgs-output.js` — generates BoG-bound movement files (CSV format with documented schema; real BoG integration deferred to Phase 10)
- `modules/settlement-cycle/controller.js`
- `modules/settlement-cycle/routes.js`
- `modules/settlement-cycle/server.js` (port 4404)
- `modules/settlement-cycle/index.js`
- `modules/settlement-cycle/tests/cycle.test.js`

**`migrations/0021_settlement_cycles.sql`:**

```sql
CREATE TABLE IF NOT EXISTS settlement_cycles (
  id                  UUID PRIMARY KEY,
  cycle_type          TEXT NOT NULL,                 -- 'INTRADAY_NET' | 'END_OF_DAY' | 'RTGS_GROSS' | 'EXCEPTION'
  currency            CHAR(3) NOT NULL,
  operating_date      DATE NOT NULL,
  triggered_by        TEXT NOT NULL,                 -- 'scheduler' | 'operator:<userId>' | 'eod-worker'
  triggered_reason    TEXT,
  state               TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'completed' | 'failed'
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  net_movement_count  INT,
  total_dr_minor      NUMERIC(38,0),
  total_cr_minor      NUMERIC(38,0),
  rtgs_output_path    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS settlement_cycles_date_idx ON settlement_cycles(operating_date, currency);
CREATE INDEX IF NOT EXISTS settlement_cycles_state_idx ON settlement_cycles(state);

CREATE TABLE IF NOT EXISTS settlement_cycle_movements (
  id                  UUID PRIMARY KEY,
  cycle_id            UUID NOT NULL REFERENCES settlement_cycles(id) ON DELETE RESTRICT,
  participant_code    TEXT NOT NULL,
  currency            CHAR(3) NOT NULL,
  net_position_minor  NUMERIC(38,0) NOT NULL,        -- the position at cycle close
  movement_minor      NUMERIC(38,0) NOT NULL,        -- positive = participant pays rail, negative = rail pays participant
  posted_journal_id   UUID REFERENCES ledger_journal(id),
  UNIQUE (cycle_id, participant_code, currency)
);

CREATE INDEX IF NOT EXISTS cycle_movements_cycle_idx ON settlement_cycle_movements(cycle_id);
```

**Cycle algorithm (`cycle-runner.run(cycleId)`):**
1. Mark cycle `running`.
2. In a single `withTransaction`:
   - Read every `settlement_position` for the cycle's currency.
   - For each non-zero position, generate a movement record.
   - Build the RTGS output file (one row per movement) — write to `output/rtgs/<cycle_id>-<currency>-<operating_date>.csv` with columns `participant_code, direction, amount_minor, currency`.
   - Post one ledger journal per movement: `OPERATOR_RTGS_NOSTRO ↔ PARTICIPANT_SETTLEMENT` for that currency.
   - Reset each `settlement_positions.position_minor` to 0, set `last_cycle_id = cycleId`.
   - Mark cycle `completed`.
3. Audit `cycle.completed`.

**Function signature enforcement (per Phase 4 lesson):**
```js
runCycle(cycleId, { confirmation })   // confirmation is required, contains operatorId or 'scheduler'
closeCycle(cycleId, closingReason)    // closingReason is required and validated
```

**Routes:**
- `GET /settlement-cycle/cycles` — list
- `GET /settlement-cycle/cycles/:id` — full detail with movements
- `POST /settlement-cycle/cycles` — admin — body `{cycleType, currency, operatingDate, reason}`
- `POST /settlement-cycle/cycles/:id/run` — admin — body `{confirmation}`
- `GET /settlement-cycle/cycles/:id/rtgs-output` — download the generated file

**Scheduler:** Phase 5 ships a simple in-process scheduler (`workers/intraday-scheduler.js`) that creates and runs `INTRADAY_NET` cycles every N hours per currency, where N comes from `core/config.js` (`config.intradayCycleHours`, default 4). Real cron/k8s cronjob is a Phase 10 deferred item.

**Exit checks:** standard. Tests:
- Cycle nets across multiple participants
- RTGS output file exists with correct schema
- Positions reset to 0 after cycle
- Ledger journals balance
- Cycle is idempotent — re-running a `completed` cycle is a no-op
- Cycle in `running` state cannot be re-run (in-progress lock)

---

## B5.5 — `modules/eod/` (cutover, freeze, day rollover)

**Purpose.** End of day. Run the EOD settlement cycle, generate signed statements per participant, freeze the day's records cryptographically, and roll into the next operating day. The rail does not go down — only the day boundary changes.

**Files to create.**
- `migrations/0022_operating_days.sql`
- `migrations/0023_settlement_statements.sql`
- `modules/eod/schema.js`
- `modules/eod/model.js`
- `modules/eod/service.js`
- `modules/eod/cutover.js`
- `modules/eod/statement-generator.js`
- `modules/eod/controller.js`
- `modules/eod/routes.js`
- `modules/eod/server.js` (port 4405)
- `modules/eod/index.js`
- `modules/eod/tests/eod.test.js`

**`migrations/0022_operating_days.sql`:**

```sql
CREATE TABLE IF NOT EXISTS operating_days (
  id                  UUID PRIMARY KEY,
  operating_date      DATE UNIQUE NOT NULL,
  state               TEXT NOT NULL DEFAULT 'OPEN', -- 'OPEN' | 'CLOSING' | 'CLOSED'
  opened_at           TIMESTAMPTZ NOT NULL,
  cutover_at          TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  closing_journal_seq BIGINT,
  closing_chain_hash  TEXT,                           -- hash of the last journal of the day
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS operating_days_state_idx ON operating_days(state);
```

Add `operating_date DATE` column to `transactions` (already referenced earlier — migration here populates retroactively):

```sql
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS operating_date DATE;

UPDATE transactions
SET operating_date = COALESCE(authorized_at, created_at)::date
WHERE operating_date IS NULL;

ALTER TABLE transactions ALTER COLUMN operating_date SET NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_operating_date_idx ON transactions(operating_date);
```

**`migrations/0023_settlement_statements.sql`:**

```sql
CREATE TABLE IF NOT EXISTS settlement_statements (
  id                  UUID PRIMARY KEY,
  operating_day_id    UUID NOT NULL REFERENCES operating_days(id),
  operating_date      DATE NOT NULL,
  participant_code    TEXT NOT NULL,
  currency            CHAR(3) NOT NULL,
  opening_position_minor   NUMERIC(38,0) NOT NULL,
  total_credits_minor      NUMERIC(38,0) NOT NULL,
  total_debits_minor       NUMERIC(38,0) NOT NULL,
  total_fees_minor         NUMERIC(38,0) NOT NULL,
  cycle_count              INT NOT NULL,
  net_settled_minor        NUMERIC(38,0) NOT NULL,
  closing_position_minor   NUMERIC(38,0) NOT NULL,
  payload                  JSONB NOT NULL,
  signature_b64            TEXT NOT NULL,
  signature_kid            TEXT NOT NULL,
  signature_alg            TEXT NOT NULL DEFAULT 'Ed25519',
  issued_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operating_day_id, participant_code, currency)
);

CREATE INDEX IF NOT EXISTS settlement_statements_participant_idx ON settlement_statements(participant_code, operating_date DESC);
```

**Cutover sequence (`cutover.run({ operatingDate, confirmation })`):**
1. Verify operating day is `OPEN`.
2. Transition operating day to `CLOSING`.
3. Run final settlement cycle as `END_OF_DAY` for every active currency.
4. For every participant + currency, generate a settlement statement (compute opening position, credits, debits, fees, cycles run, net settled, closing position from `ledger_postings` for that day).
5. Sign each statement with the rail's active Ed25519 key.
6. Freeze: capture the last `journal_seq` of the day in `operating_days.closing_journal_seq`, capture `closing_chain_hash`.
7. Open the next operating day (insert new row with state `OPEN`).
8. Transition the closed day to `CLOSED`. Audit `eod.completed`.

**Critical invariant:** while the operating day is `CLOSING`, transactions in flight continue normally — they're just stamped with the new operating date if they cross the cutover. Recovery and reversals work across day boundaries (reversal of a confirmed transaction from a previous closed day posts on the current day with a back-reference).

**Routes:**
- `GET /eod/days` — list operating days
- `GET /eod/days/:date` — full detail incl. statement summaries
- `POST /eod/cutover` — admin only — body `{operatingDate, confirmation}`
- `GET /eod/statements/:date` — list day's statements
- `GET /eod/statements/:date/:participantCode/:currency` — fetch statement (includes verifiable signature)
- `GET /eod/statements/verify` — public verification endpoint (same shape as receipt verify)

**Exit checks:** standard. Tests:
- Full-day simulation: open day, run 50 transactions, run 2 intraday cycles, run EOD cutover
- Statements signed and verifiable
- Closed day is irreversible (`CLOSED` → cannot transition back)
- Re-running EOD on a closed day is rejected
- Transactions crossing the cutover are stamped with the new day
- Day rollover: the next day opens automatically with state `OPEN`

---

## B5.6 — `modules/reconciliation/`

**Purpose.** Continuous and EOD reconciliation between the rail's ledger and a participant's books. Phase 5 ships the framework with a stub-able participant feed (real integrations land in Phase 10). Breaks go into an exception queue with structured reason codes.

**Files to create.**
- `migrations/0024_reconciliation.sql`
- `modules/reconciliation/schema.js`
- `modules/reconciliation/model.js`
- `modules/reconciliation/service.js`
- `modules/reconciliation/feed-client.js` — pluggable participant-feed interface
- `modules/reconciliation/controller.js`
- `modules/reconciliation/routes.js`
- `modules/reconciliation/server.js` (port 4406)
- `modules/reconciliation/index.js`
- `modules/reconciliation/tests/recon.test.js`

**`migrations/0024_reconciliation.sql`:**

```sql
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id                  UUID PRIMARY KEY,
  participant_code    TEXT NOT NULL REFERENCES participants(code),
  currency            CHAR(3) NOT NULL,
  operating_date      DATE NOT NULL,
  run_type            TEXT NOT NULL,                  -- 'CONTINUOUS' | 'EOD' | 'EXCEPTION'
  state               TEXT NOT NULL DEFAULT 'pending',
  total_compared      INT NOT NULL DEFAULT 0,
  total_matched       INT NOT NULL DEFAULT 0,
  total_breaks        INT NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS reconciliation_breaks (
  id                  UUID PRIMARY KEY,
  run_id              UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  break_type          TEXT NOT NULL,                  -- 'MISSING_AT_PARTICIPANT' | 'MISSING_AT_RAIL' | 'AMOUNT_MISMATCH' | 'STATUS_MISMATCH'
  rail_transaction_id UUID,
  participant_ref     TEXT,
  amount_minor        NUMERIC(38,0),
  currency            CHAR(3),
  rail_state          TEXT,
  participant_state   TEXT,
  resolution          TEXT,                            -- 'pending' | 'auto_resolved' | 'operator_resolved' | 'escalated'
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recon_breaks_run_idx ON reconciliation_breaks(run_id);
CREATE INDEX IF NOT EXISTS recon_breaks_unresolved_idx ON reconciliation_breaks(resolution) WHERE resolution = 'pending';
```

**Pluggable feed interface (`feed-client.js`):**

```js
export const createParticipantFeedClient = ({ mode = 'fake' }) => ({
  fetch: async ({ participantCode, currency, sinceSeq, limit }) =>
    ({ entries: [{ ref, amountMinor, currency, state, postedAt }], nextCursor })
});
```

The fake (`mode='fake'`) mirrors the rail's own ledger — for any participant, calling `fetch` returns the same entries the rail itself has. It's a deliberate identity feed used to prove the recon machinery works. Real integrations slot in later.

**Service:** `runReconciliation({ participantCode, currency, operatingDate, runType })` opens a `reconciliation_run`, walks the rail's ledger postings for the day, fetches the participant's feed, matches by `transactionId/ref + amount + currency`, records breaks with structured types. On `MISSING_AT_PARTICIPANT` for confirmed transactions older than the configurable `recon_break_age_seconds`, writes audit `settlement.adjustment_needed` (per Phase 4 conservative-reversal rule).

**Auto-resolution:** breaks of type `STATUS_MISMATCH` where the rail says CONFIRMED and participant says NOT_CREDITED for txns less than the recon-window are left `pending` (recovery worker may resolve them). After the recon window, they escalate.

**Routes:**
- `GET /reconciliation/runs` — list
- `GET /reconciliation/runs/:id` — full detail with breaks
- `POST /reconciliation/runs` — admin trigger
- `GET /reconciliation/breaks` — list with filters
- `POST /reconciliation/breaks/:id/resolve` — operator resolution

**Exit checks:** standard. Tests:
- Identity feed: zero breaks
- Inject break by mutating participant feed: detected, stored
- EOD recon runs automatically on cutover

---

## B5.7 — `modules/fees/`

**Purpose.** Per-transaction-class fee schedules. Fees accrue at the `AUTHORIZED` transition, post to the ledger as part of the same transaction's journal at `CONFIRMED`. Fee revenue accumulates in `RAIL_FEE_REVENUE`. Per-participant fee summaries available to ops.

**Files to create.**
- `migrations/0025_fees.sql`
- `modules/fees/schema.js`
- `modules/fees/model.js`
- `modules/fees/service.js`
- `modules/fees/calculator.js`
- `modules/fees/controller.js`
- `modules/fees/routes.js`
- `modules/fees/server.js` (port 4407)
- `modules/fees/index.js`
- `modules/fees/tests/fees.test.js`

**`migrations/0025_fees.sql`:**

```sql
CREATE TABLE IF NOT EXISTS fee_schedules (
  id                  UUID PRIMARY KEY,
  schedule_code       TEXT UNIQUE NOT NULL,
  rail_class          TEXT NOT NULL,                  -- matches rail-orchestration class names
  currency            CHAR(3) NOT NULL,
  fee_type            TEXT NOT NULL,                  -- 'FLAT' | 'PERCENTAGE' | 'TIERED'
  flat_minor          NUMERIC(38,0),
  pct_bps             INT,                             -- basis points; 25 bps = 0.25%
  tiers               JSONB,                           -- [{from_minor, to_minor, fee_minor, fee_bps}]
  min_fee_minor       NUMERIC(38,0) NOT NULL DEFAULT 0,
  max_fee_minor       NUMERIC(38,0),
  bearer              TEXT NOT NULL DEFAULT 'DEBT',   -- 'DEBT' | 'CRED' | 'SHAR'
  effective_from      TIMESTAMPTZ NOT NULL,
  effective_to        TIMESTAMPTZ,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (fee_type = 'FLAT' AND flat_minor IS NOT NULL) OR
    (fee_type = 'PERCENTAGE' AND pct_bps IS NOT NULL) OR
    (fee_type = 'TIERED' AND tiers IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS fee_schedules_active_idx ON fee_schedules(active, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS fee_schedules_class_idx ON fee_schedules(rail_class, currency);
```

**Service API:**

```js
publishSchedule({ ... })     // operator action; old schedule becomes inactive
calculateFee({ railClass, currency, amountMinor, asOf }) -> { feeMinor, scheduleId, breakdown }
listSchedules({ railClass, currency, active })
```

**Integration:** `transactions/orchestrator.js` calls `fees.calculateFee` at the AUTHORIZED transition, stamps `transactions.fee_minor` (new column via migration), and includes the fee in the ledger journal at CONFIRMED. The fee leg is `CR RAIL_FEE_REVENUE`.

**Schedule rollover:** publishing a new schedule for an existing `(railClass, currency)` pair sets the previous schedule's `effective_to = now()` atomically with the insert.

**Seed:** Phase 5 seed adds default schedules: GHS DOMESTIC_INSTANT = flat 50 minor (GHS 0.50), GHS MOBILE_MONEY_INTEROP = pct 25 bps min 50 minor max 5000 minor.

**Routes:**
- `GET /fees/schedules`
- `POST /fees/schedules` — admin
- `GET /fees/schedules/:code`
- `POST /fees/calculate` — `{railClass, currency, amountMinor}`
- `GET /fees/summary` — admin only — per-participant fee accrual summary for date range

**Exit checks:** standard. Tests:
- Flat fee
- Percentage fee with min/max
- Tiered fee
- Schedule rollover atomicity
- Phase 4 retroactive integration: the orchestrator now stamps a fee, the ledger journal includes the fee leg, the journal balances

---

## B5.8 — Phase 5 exit gate

**Purpose.** Lock the phase. Single demo script proves a full operating day from open to close.

**Files to create.**
- `scripts/demo-phase-5.sh`
- `tests/phase-5-eod.test.js`

**`scripts/demo-phase-5.sh`:**

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pnpm reset
pnpm migrate
pnpm seed
pnpm vitest run
pnpm lint
pnpm check-boundaries

TX_TEST_MODE=true node server.js > /tmp/sika-server-p5.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if curl -sf http://localhost:3000/health > /dev/null; then break; fi
  sleep 0.2
done

C=$(mktemp)
curl -sf -c "$C" -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}' > /dev/null

echo "==> open operating day"
TODAY=$(date +%F)
curl -sf -b "$C" http://localhost:3000/eod/days/$TODAY > /dev/null

echo "==> 1. Configure liquidity for demo participants"
for P in P5BANK01 P5BANK02; do
  curl -sf -b "$C" -X PUT "http://localhost:3000/liquidity/limits/$P/GHS" \
    -H 'content-type: application/json' \
    -d '{"prefundedMinor":"10000000","floorMinor":"0","ceilingMinor":"5000000","throttleThresholdPct":80}'
  curl -sf -b "$C" -X POST http://localhost:3000/liquidity/topup \
    -H 'content-type: application/json' \
    -d "{\"participantCode\":\"$P\",\"currency\":\"GHS\",\"amountMinor\":\"5000000\",\"reason\":\"Phase 5 demo\"}"
done

echo "==> 2. Run 10 confirmed transactions across the participants"
for i in $(seq 1 10); do
  curl -sf -b "$C" -X POST http://localhost:3000/adapters-rest/inbound \
    -H 'content-type: application/json' \
    -d "$(node scripts/build-fixture.mjs envelope p5 $i)" > /dev/null
done

echo "==> 3. Verify ledger balanced"
curl -sf -b "$C" "http://localhost:3000/ledger/verify/$TODAY" | jq -e '.data.ok == true'

echo "==> 4. Trigger intraday cycle"
CYCLE=$(curl -sf -b "$C" -X POST http://localhost:3000/settlement-cycle/cycles \
  -H 'content-type: application/json' \
  -d "{\"cycleType\":\"INTRADAY_NET\",\"currency\":\"GHS\",\"operatingDate\":\"$TODAY\",\"reason\":\"Phase 5 demo intraday\"}")
CYCLE_ID=$(echo "$CYCLE" | jq -r '.data.id')
curl -sf -b "$C" -X POST "http://localhost:3000/settlement-cycle/cycles/$CYCLE_ID/run" \
  -H 'content-type: application/json' \
  -d '{"confirmation":"phase-5-demo"}' > /dev/null

echo "==> 5. Verify positions are now zero post-cycle"
curl -sf -b "$C" "http://localhost:3000/settlement/positions/P5BANK01" | jq -e '.data | map(select(.currency=="GHS")) | .[0].positionMinor == "0"'

echo "==> 6. Run more transactions, then EOD cutover"
for i in $(seq 11 20); do
  curl -sf -b "$C" -X POST http://localhost:3000/adapters-rest/inbound \
    -H 'content-type: application/json' \
    -d "$(node scripts/build-fixture.mjs envelope p5 $i)" > /dev/null
done

echo "==> 7. EOD cutover"
curl -sf -b "$C" -X POST http://localhost:3000/eod/cutover \
  -H 'content-type: application/json' \
  -d "{\"operatingDate\":\"$TODAY\",\"confirmation\":\"phase-5-demo-eod\"}" > /dev/null

echo "==> 8. Verify day is CLOSED, statements issued"
curl -sf -b "$C" "http://localhost:3000/eod/days/$TODAY" | jq -e '.data.state == "CLOSED"'
STMT=$(curl -sf -b "$C" "http://localhost:3000/eod/statements/$TODAY")
test "$(echo "$STMT" | jq '.data | length')" -ge 2

echo "==> 9. Verify reconciliation ran clean (identity feed → zero breaks)"
curl -sf -b "$C" "http://localhost:3000/reconciliation/runs?operatingDate=$TODAY&runType=EOD" \
  | jq -e '.data | all(.totalBreaks == 0)'

echo "==> 10. Verify next operating day is OPEN"
TOMORROW=$(date -d "$TODAY +1 day" +%F)
curl -sf -b "$C" "http://localhost:3000/eod/days/$TOMORROW" | jq -e '.data.state == "OPEN"'

kill $SERVER_PID
echo "PHASE 5 OK"
```

**Phase 5 exit gate (paste output):**
- `bash scripts/demo-phase-5.sh` — prints `PHASE 5 OK`
- `pnpm vitest run` — all green; expect ~600+ total
- `pnpm lint`, `pnpm check-boundaries` — clean
- `pnpm reset && pnpm migrate && pnpm seed` — 25 migrations apply clean
- `git log --oneline | head -50` — shows 8 phase-5 commits

---

## What "PHASE 5 OK" unlocks

After Phase 5:
- Every confirmed transaction posts a balanced double-entry journal atomically.
- The ledger's hash chain proves the day's books haven't been tampered with.
- Real-time settlement positions show ops who owes whom, by participant and currency.
- Liquidity limits prevent participants from blowing up settlement.
- Intraday and EOD cycles produce RTGS-bound movement files (file format is the integration point — real BoG hookup is Phase 10).
- Settlement statements are signed and verifiable, one per participant per currency per day.
- The operating day cutover is clean — transactions never stop.
- Continuous reconciliation flags drift before EOD.
- Fee schedules accrue and net into the same cycles.
- Phase 6 (fraud) plugs into the authorization pipeline alongside the now-real liquidity check.
- Phase 7 (disputes) plugs into the reversal flow with the dispute reserve account ready.
- Phase 9 (cross-border) plugs into the multi-currency-aware ledger.
