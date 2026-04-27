# PHASE 8 — Overlay Services

**Mode:** Autonomous. Single master prompt, no per-block sign-off.

**Goal at end of phase:**
- Every overlay service from PIX, UPI, and the modern overlay catalog ships as a thin layer on top of the Phase 4 transaction lifecycle.
- 8 overlays: Request to Pay (R2P), QR (static + dynamic), recurring mandates, bulk payments, cash-out at agent, refunds, escrow, split payments.
- Each overlay reuses the orchestrator, the canonical envelope, the existing fraud/sanctions/liquidity stack, the existing ledger, and the existing dispute pipeline.
- New envelope `msgType` values for overlay-specific instructions, but the same Phase 4 state machine handles them all.
- Overlay-specific dispute reason codes added to the Phase 7 locked taxonomy.

**Why this phase is structurally easy.** Every primitive needed exists. The architectural rule (locked in CLAUDE.md): overlays do not reinvent payment primitives. They compose the existing ones into customer-facing products.

---

## What's in scope, what isn't

**In scope (Phase 8):**
- 8 overlay modules, each shipping its own service + table + state machine + integration with the orchestrator
- New envelope `msgType` values: `R2P_REQUEST`, `R2P_AUTHORIZE`, `MANDATE_CREATE`, `MANDATE_DEBIT`, `BULK_BATCH`, `CASHOUT_REQUEST`, `REFUND`, `ESCROW_HOLD`, `ESCROW_RELEASE`, `SPLIT_INSTRUCTION`
- New dispute reason codes for overlays: `R2P_DUPLICATE`, `MANDATE_UNAUTHORIZED`, `MANDATE_EXCESS`, `REFUND_DUPLICATE`, `ESCROW_RELEASE_DISPUTED`
- QR code parsing/generation (EMVCo MPM standard)
- Bulk-payment line-item tracking
- Recurring mandate scheduler worker

**NOT in scope (deferred to Phase 9 or 10):**
- Cross-border R2P (interlinking with foreign R2P systems) → Phase 9
- Real-time R2P notification push to consumer apps → Phase 10 (webhook + push)
- Programmable / oracle-triggered conditional escrow → Phase 11+
- BNPL / installment financial products → Phase 11+
- Tax/VAT integration with GRA → Phase 10

---

## Architectural shape

```
┌──────────────────────────────────────────────────────────────────┐
│                    customer-facing overlay APIs                    │
│                                                                    │
│  POST /r2p          POST /qr           POST /mandates              │
│  POST /bulk         POST /cashout      POST /refunds               │
│  POST /escrow       POST /splits                                   │
└──────────┬───────────────┬─────────────┬────────────┬─────────────┘
           │               │             │            │
           ▼               ▼             ▼            ▼
┌───────────────────────────────────────────────────────────────────┐
│   each overlay produces 1+ canonical envelopes                     │
└───────────────────────────────────────────────────────────────────┘
           │
           ▼
┌───────────────────────────────────────────────────────────────────┐
│   transactions/orchestrator.processTransaction(envelope)            │
│   (Phase 4 — auth → routing → credit-leg → atomic outcome)          │
└───────────────────────────────────────────────────────────────────┘
           │
           ▼
┌───────────────────────────────────────────────────────────────────┐
│   ledger / fraud / sanctions / disputes (Phases 5, 6, 7)            │
└───────────────────────────────────────────────────────────────────┘
```

---

## Locked: overlay msgType extensions

These are exhaustive for Phase 8. CC must not invent more.

| msgType | Adds | Behavior |
|---|---|---|
| `R2P_REQUEST` | Pull-style request from beneficiary to payer | Stored, sent to payer's participant; no money moves |
| `R2P_AUTHORIZE` | Payer authorizes an existing R2P request | Triggers a `CRDT_TRF` envelope back through the orchestrator |
| `MANDATE_CREATE` | Customer authorizes recurring debits to a payee | Stored as mandate; no money moves until first cycle |
| `MANDATE_DEBIT` | Scheduler-issued debit under an existing mandate | Becomes a `CRDT_TRF` through the orchestrator |
| `BULK_BATCH` | Multiple debits in one batch | Each line becomes one `CRDT_TRF` |
| `CASHOUT_REQUEST` | Customer requests cash withdrawal at an agent | Becomes a `CRDT_TRF` from customer to agent's float |
| `REFUND` | Cryptographically linked to original transaction | Becomes a `CRDT_TRF` from beneficiary back to originator |
| `ESCROW_HOLD` | Customer locks funds in escrow | Becomes a `CRDT_TRF` from customer to RAIL_ESCROW account |
| `ESCROW_RELEASE` | Release condition met | Becomes a `CRDT_TRF` from RAIL_ESCROW to beneficiary |
| `SPLIT_INSTRUCTION` | One debit, N credits, atomic | One originator envelope produces N beneficiary credits in a single transaction |

Each overlay envelope carries `metadata.overlay = { type, overlayId, ... }` so the orchestrator and downstream modules can recognize the linkage.

---

## Locked: new ledger account type

`RAIL_ESCROW` — added to `modules/ledger/codes.js` as a new account type for B8.7. Used to hold escrowed funds. One per currency.

```
ESCROW_HOLD posts:
  DR PARTICIPANT_SETTLEMENT(originator)   amount
  CR RAIL_ESCROW                          amount

ESCROW_RELEASE posts:
  DR RAIL_ESCROW                          amount
  CR PARTICIPANT_SETTLEMENT(beneficiary)  amount
```

---

## B8.1 — Request to Pay (R2P)

**Purpose.** A beneficiary sends a payment request to a payer. The payer's participant displays the request to the customer, who authorizes (or rejects) it. On authorize, a normal credit transfer fires through the orchestrator. Useful for: invoices, e-commerce checkout, peer-to-peer split-the-bill, recurring bill reminders.

**Files to create.**
- `migrations/0036_r2p_requests.sql`
- `modules/overlays-r2p/codes.js`
- `modules/overlays-r2p/states.js`
- `modules/overlays-r2p/schema.js`
- `modules/overlays-r2p/model.js`
- `modules/overlays-r2p/service.js`
- `modules/overlays-r2p/controller.js`
- `modules/overlays-r2p/routes.js`
- `modules/overlays-r2p/server.js` (port 4701, key `overlaysR2pPort`)
- `modules/overlays-r2p/index.js`
- `modules/overlays-r2p/tests/r2p.test.js`

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS r2p_requests (
  id                  UUID PRIMARY KEY,
  request_number      TEXT UNIQUE NOT NULL,             -- 'R2P-YYYYMM-NNNNNN'
  requester_participant TEXT NOT NULL REFERENCES participants(code),
  requester_account_id  UUID NOT NULL REFERENCES accounts(id),
  payer_participant   TEXT NOT NULL REFERENCES participants(code),
  payer_account_id    UUID,                              -- null until resolved by alias
  payer_alias_type    TEXT,
  payer_alias_value   TEXT,
  amount_minor        NUMERIC(38,0) NOT NULL,
  currency            CHAR(3) NOT NULL,
  reason              TEXT,
  reference           TEXT,
  state               TEXT NOT NULL DEFAULT 'PENDING',    -- 'PENDING' | 'AUTHORIZED' | 'REJECTED' | 'EXPIRED' | 'PAID'
  expires_at          TIMESTAMPTZ NOT NULL,
  authorized_at       TIMESTAMPTZ,
  paid_transaction_id UUID REFERENCES transactions(id),
  rejected_reason     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS r2p_payer_idx ON r2p_requests(payer_participant, state);
CREATE INDEX IF NOT EXISTS r2p_requester_idx ON r2p_requests(requester_participant);
CREATE INDEX IF NOT EXISTS r2p_pending_expiry_idx ON r2p_requests(state, expires_at) WHERE state = 'PENDING';
```

**Default expiry:** 24 hours, configurable per request (1 hour to 30 days).

**Flow:**
1. Requester's participant POSTs `/r2p` with payer's alias (or account), amount, reason. Service creates a `PENDING` request, returns request number.
2. Payer's participant fetches pending requests for their customer via `GET /r2p?payerParticipant=X`.
3. Payer authorizes via `POST /r2p/:requestNumber/authorize` (with strong auth at the participant). Service creates a `CRDT_TRF` envelope and calls `transactions.orchestrator.processTransaction`. On confirmed result, marks the R2P `PAID` and links `paid_transaction_id`.
4. Payer rejects via `POST /r2p/:requestNumber/reject` with reason.
5. Background worker expires PENDING requests past `expires_at`.

**Sanctions/fraud paths.** All standard — the resulting `CRDT_TRF` envelope flows through the same Phase 6 stack. R2P-specific fraud signal: payer rejects more than N% of requests from a given requester → flag.

**Disputes.** New reason `R2P_DUPLICATE` added to `modules/disputes/codes.js`: customer paid the same R2P twice. Auto-resolvable if two `PAID` R2P requests from the same requester to the same payer within 60s match in amount.

**Idempotency.** Re-POSTing `/r2p` with the same `(requesterParticipant, idempotencyKey)` returns the existing request.

**Exit checks:** standard. Tests:
- Create → authorize → PAID with linked transaction
- Create → expires after window → EXPIRED
- Create → reject → REJECTED with reason
- Authorize already-EXPIRED returns error
- Authorize already-PAID is idempotent
- R2P_DUPLICATE auto-resolves correctly

---

## B8.2 — QR Codes (EMVCo MPM)

**Purpose.** Static QRs (printed on a stall, encodes merchant alias) and dynamic QRs (generated per transaction, encodes amount and merchant alias). The rail defines the format following EMVCo Merchant-Presented Mode (MPM) standard. Customer scans → confirms amount → standard authorization flow.

**Files to create.**
- `migrations/0037_qr_codes.sql`
- `modules/overlays-qr/codes.js`
- `modules/overlays-qr/emvco-encoder.js`           — encodes per EMVCo MPM
- `modules/overlays-qr/emvco-decoder.js`           — decodes
- `modules/overlays-qr/schema.js`
- `modules/overlays-qr/model.js`
- `modules/overlays-qr/service.js`
- `modules/overlays-qr/controller.js`
- `modules/overlays-qr/routes.js`
- `modules/overlays-qr/server.js` (port 4702)
- `modules/overlays-qr/index.js`
- `modules/overlays-qr/tests/qr.test.js`

**EMVCo MPM format**, simplified for Sika:
- ID 00: Payload Format Indicator = "01"
- ID 01: Point of Initiation Method = "11" (static) or "12" (dynamic)
- ID 26-27 (merchant account info): nested TLVs:
  - 00: Globally Unique Identifier = "GH.SIKA.RAIL"
  - 01: Merchant participant code (8 chars)
  - 02: Merchant account number or alias
- ID 52: Merchant Category Code (MCC, 4 digits)
- ID 53: Transaction Currency = "936" for GHS (ISO 4217 numeric)
- ID 54: Transaction Amount (only for dynamic QRs)
- ID 58: Country Code = "GH"
- ID 59: Merchant Name (max 25 chars)
- ID 60: Merchant City (max 15 chars)
- ID 62: Additional Data Field Template (for dynamic — includes a unique reference)
- ID 63: CRC (CRC-16/CCITT-FALSE over the entire payload)

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS qr_codes (
  id                  UUID PRIMARY KEY,
  qr_type             TEXT NOT NULL,                    -- 'STATIC' | 'DYNAMIC'
  merchant_participant TEXT NOT NULL REFERENCES participants(code),
  merchant_account_id UUID NOT NULL REFERENCES accounts(id),
  merchant_alias_type TEXT,
  merchant_alias_value TEXT,
  mcc                 TEXT NOT NULL,
  amount_minor        NUMERIC(38,0),                    -- null for static
  currency            CHAR(3) NOT NULL,
  reference           TEXT,
  expires_at          TIMESTAMPTZ,                      -- null for static
  encoded_payload     TEXT NOT NULL,                    -- the actual QR string
  state               TEXT NOT NULL DEFAULT 'ACTIVE',   -- 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'REVOKED'
  consumed_transaction_id UUID REFERENCES transactions(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qr_merchant_idx ON qr_codes(merchant_participant);
CREATE INDEX IF NOT EXISTS qr_active_idx ON qr_codes(state) WHERE state = 'ACTIVE';
```

**Dynamic QR uniqueness.** Each dynamic QR can only be consumed once (`CONSUMED` state). Static QRs are reusable indefinitely.

**Routes:**
- `POST /qr/static` — body `{merchantAccountId, mcc}` → returns encoded QR string
- `POST /qr/dynamic` — body `{merchantAccountId, mcc, amountMinor, expiresInSeconds}` → returns encoded QR string + reference
- `POST /qr/decode` — body `{encodedPayload}` → returns decoded fields
- `POST /qr/pay` — body `{encodedPayload, payerParticipant, payerAccountId, payerName}` → decodes, builds `CRDT_TRF` envelope, calls orchestrator, returns transaction
- `POST /qr/:id/revoke` — merchant revokes (only static)

**CRC validation.** `decode` must validate the CRC. Wrong CRC → reject as malformed.

**Exit checks:** standard. Tests:
- Encode → decode round-trip preserves fields
- CRC validation: tampered payload rejected
- Static QR pays multiple times
- Dynamic QR pays once, second attempt rejected
- Dynamic QR expires after window

---

## B8.3 — Recurring Mandates

**Purpose.** Customer authorizes an entity (telco, insurance, subscription service) to debit their account up to a defined cap, at a defined frequency, until revoked. Replaces broken direct-debit. Mirrors UPI Autopay / PIX Automático.

**Files to create.**
- `migrations/0038_mandates.sql`
- `modules/overlays-mandates/codes.js`
- `modules/overlays-mandates/states.js`
- `modules/overlays-mandates/schema.js`
- `modules/overlays-mandates/model.js`
- `modules/overlays-mandates/service.js`
- `modules/overlays-mandates/scheduler-worker.js`
- `modules/overlays-mandates/controller.js`
- `modules/overlays-mandates/routes.js`
- `modules/overlays-mandates/server.js` (port 4703)
- `modules/overlays-mandates/index.js`
- `modules/overlays-mandates/tests/mandates.test.js`

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS mandates (
  id                       UUID PRIMARY KEY,
  mandate_number           TEXT UNIQUE NOT NULL,            -- 'MND-YYYYMM-NNNNNN'
  payer_participant        TEXT NOT NULL REFERENCES participants(code),
  payer_account_id         UUID NOT NULL REFERENCES accounts(id),
  payee_participant        TEXT NOT NULL REFERENCES participants(code),
  payee_account_id         UUID NOT NULL REFERENCES accounts(id),
  per_debit_cap_minor      NUMERIC(38,0) NOT NULL,
  daily_cap_minor          NUMERIC(38,0),
  monthly_cap_minor        NUMERIC(38,0),
  total_cap_minor          NUMERIC(38,0),                    -- null = unlimited until revoked
  currency                 CHAR(3) NOT NULL,
  frequency                TEXT NOT NULL,                    -- 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'AS_PRESENTED'
  reference                TEXT,
  description              TEXT,
  state                    TEXT NOT NULL DEFAULT 'ACTIVE',  -- 'ACTIVE' | 'PAUSED' | 'REVOKED' | 'EXHAUSTED'
  authorized_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_from           TIMESTAMPTZ NOT NULL,
  effective_to             TIMESTAMPTZ,
  next_scheduled_at        TIMESTAMPTZ,
  total_debited_minor      NUMERIC(38,0) NOT NULL DEFAULT 0,
  total_debit_count        INT NOT NULL DEFAULT 0,
  last_debited_at          TIMESTAMPTZ,
  revoked_at               TIMESTAMPTZ,
  revoked_by               TEXT,                              -- 'PAYER' | 'PAYEE' | 'OPERATOR'
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS mandates_payer_idx ON mandates(payer_participant, state);
CREATE INDEX IF NOT EXISTS mandates_due_idx ON mandates(next_scheduled_at) WHERE state = 'ACTIVE' AND frequency != 'AS_PRESENTED';

CREATE TABLE IF NOT EXISTS mandate_debits (
  id                  UUID PRIMARY KEY,
  mandate_id          UUID NOT NULL REFERENCES mandates(id) ON DELETE RESTRICT,
  transaction_id      UUID REFERENCES transactions(id),
  presented_amount_minor NUMERIC(38,0) NOT NULL,
  result              TEXT NOT NULL,                           -- 'SUCCESS' | 'CAP_BREACH' | 'INSUFFICIENT_FUNDS' | 'PAUSED' | 'OTHER'
  result_message      TEXT,
  presented_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mandate_debits_mandate_idx ON mandate_debits(mandate_id);
```

**Cap enforcement (locked algorithm):**
1. Per-debit cap — instant check, reject if `presentedAmount > per_debit_cap_minor`.
2. Daily cap — sum of successful debits in last 24h + presented amount must be ≤ `daily_cap_minor`.
3. Monthly cap — sum of successful debits since first day of current month + presented amount must be ≤ `monthly_cap_minor`.
4. Total cap — `total_debited_minor + presentedAmount` must be ≤ `total_cap_minor`.

**Scheduler worker.** Runs every 60 seconds. Picks up active mandates with `frequency != 'AS_PRESENTED'` and `next_scheduled_at <= now()`. For each, presents a debit (using the `payee_account` as the credit beneficiary), records a `mandate_debits` row, advances `next_scheduled_at` per frequency (DAILY = +1d, WEEKLY = +7d, MONTHLY = +1m). Uses `SELECT FOR UPDATE SKIP LOCKED LIMIT 100`.

**Revocation.** Either side (payer, payee) or operator can revoke. Revocation is instantaneous — `state = REVOKED`, `next_scheduled_at = NULL`. No further debits process.

**Disputes.** New reason codes:
- `MANDATE_UNAUTHORIZED` — customer claims they didn't authorize the mandate
- `MANDATE_EXCESS` — debit amount exceeded the cap

**Exit checks:** standard. Tests:
- Create active mandate, scheduler triggers DAILY debit, debit produces a CRDT_TRF
- Per-debit cap breach blocks debit
- Daily cap breach blocks debit
- Monthly cap breach blocks debit
- Revocation is instant — next scheduler tick does not debit
- AS_PRESENTED mandate: payee POSTs a debit explicitly, only succeeds within caps

---

## B8.4 — Bulk Payments

**Purpose.** One file, many beneficiaries. Payroll, government disbursements, NPRA pensions, scholarship payouts. Reuses Phase 2 bulk file ingestion (B2.7) but adds the orchestration layer that processes each line through the orchestrator and tracks per-line outcomes.

**Files to create.**
- `migrations/0039_bulk_payment_runs.sql`
- `modules/overlays-bulk/codes.js`
- `modules/overlays-bulk/schema.js`
- `modules/overlays-bulk/model.js`
- `modules/overlays-bulk/service.js`
- `modules/overlays-bulk/runner-worker.js`        — processes batches asynchronously
- `modules/overlays-bulk/controller.js`
- `modules/overlays-bulk/routes.js`
- `modules/overlays-bulk/server.js` (port 4704)
- `modules/overlays-bulk/index.js`
- `modules/overlays-bulk/tests/bulk.test.js`

**Note:** Phase 2's `adapters-bulk/` ingests file content and produces envelopes. Phase 8's `overlays-bulk/` is the workflow that takes a batch, fans the envelopes through the orchestrator, tracks results, and produces a settlement report. The two work together; they're not duplicates.

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS bulk_payment_runs (
  id                       UUID PRIMARY KEY,
  run_number               TEXT UNIQUE NOT NULL,            -- 'BLK-YYYYMM-NNNNNN'
  originator_participant   TEXT NOT NULL REFERENCES participants(code),
  source_format            TEXT NOT NULL,                    -- 'CSV' | 'XLSX' | 'PAIN001'
  source_filename          TEXT NOT NULL,
  source_sha256            TEXT NOT NULL,
  total_lines              INT NOT NULL,
  total_amount_minor       NUMERIC(38,0) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'QUEUED',  -- 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL'
  succeeded_count          INT NOT NULL DEFAULT 0,
  failed_count             INT NOT NULL DEFAULT 0,
  succeeded_amount_minor   NUMERIC(38,0) NOT NULL DEFAULT 0,
  failed_amount_minor      NUMERIC(38,0) NOT NULL DEFAULT 0,
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  uploaded_by_user         UUID REFERENCES users(id),
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS bulk_runs_state_idx ON bulk_payment_runs(state);
CREATE INDEX IF NOT EXISTS bulk_runs_originator_idx ON bulk_payment_runs(originator_participant);

CREATE TABLE IF NOT EXISTS bulk_payment_lines (
  id                  UUID PRIMARY KEY,
  run_id              UUID NOT NULL REFERENCES bulk_payment_runs(id) ON DELETE CASCADE,
  line_number         INT NOT NULL,
  envelope_id         UUID REFERENCES envelopes(envelope_id),
  transaction_id      UUID REFERENCES transactions(id),
  state               TEXT NOT NULL DEFAULT 'PENDING',
  result_code         TEXT,
  result_message      TEXT,
  amount_minor        NUMERIC(38,0) NOT NULL,
  beneficiary_participant TEXT NOT NULL,
  beneficiary_account TEXT NOT NULL,
  processed_at        TIMESTAMPTZ,
  UNIQUE (run_id, line_number)
);

CREATE INDEX IF NOT EXISTS bulk_lines_run_idx ON bulk_payment_lines(run_id);
CREATE INDEX IF NOT EXISTS bulk_lines_state_idx ON bulk_payment_lines(state);
```

**Concurrency.** Worker processes lines with bounded concurrency (default 10 simultaneous). Each line is its own transaction through the orchestrator. Failures don't stop the batch.

**Idempotency.** Per-line idempotency via `(run_id, line_number)`. Re-processing a completed run is a no-op.

**Exit checks:** standard. Tests:
- 100-line CSV → 100 transactions through orchestrator, each tracked
- One bad line (frozen beneficiary account) → 99 succeeded, 1 failed reported
- Same file uploaded twice → second upload returns existing run (idempotency by source_sha256 + originator)
- Worker crash mid-run → resumable (PENDING lines pick up on restart)

---

## B8.5 — Cash-Out at Agent

**Purpose.** Customer initiates cash withdrawal at any agent (bank teller, mobile money agent, retailer). The rail moves money from the customer's account to the agent's float account. Agent dispenses cash. The agent's float is itself an account in the directory under the agent's parent participant.

**Files to create.**
- `migrations/0040_cashout_requests.sql`
- `modules/overlays-cashout/codes.js`
- `modules/overlays-cashout/states.js`
- `modules/overlays-cashout/schema.js`
- `modules/overlays-cashout/model.js`
- `modules/overlays-cashout/service.js`
- `modules/overlays-cashout/controller.js`
- `modules/overlays-cashout/routes.js`
- `modules/overlays-cashout/server.js` (port 4705)
- `modules/overlays-cashout/index.js`
- `modules/overlays-cashout/tests/cashout.test.js`

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS cashout_requests (
  id                       UUID PRIMARY KEY,
  request_number           TEXT UNIQUE NOT NULL,
  customer_participant     TEXT NOT NULL,
  customer_account_id      UUID NOT NULL REFERENCES accounts(id),
  agent_participant        TEXT NOT NULL,
  agent_float_account_id   UUID NOT NULL REFERENCES accounts(id),
  amount_minor             NUMERIC(38,0) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'INITIATED', -- 'INITIATED' | 'AUTHORIZED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'
  expires_at               TIMESTAMPTZ NOT NULL,
  authorized_at            TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  transaction_id           UUID REFERENCES transactions(id),
  agent_otp                TEXT,                                 -- short-lived; cleared after consumption
  agent_otp_expires_at     TIMESTAMPTZ,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS cashout_state_idx ON cashout_requests(state);
CREATE INDEX IF NOT EXISTS cashout_agent_idx ON cashout_requests(agent_participant);
```

**Flow:**
1. Customer initiates `POST /cashout` — request created with state `INITIATED`, OTP generated, expires in 15 minutes default.
2. Customer authorizes via their participant app (strong auth) — state `AUTHORIZED`. OTP shared with customer.
3. Customer presents OTP to agent. Agent's POS calls `POST /cashout/:id/complete` with the OTP. Service validates OTP (separate-connection counter for attempt tracking), creates a `CRDT_TRF` envelope from customer's account to agent's float, calls orchestrator. On confirmed, marks `COMPLETED`.
4. Customer or agent can cancel before completion.
5. Background worker expires INITIATED/AUTHORIZED requests past `expires_at`.

**Account types involved.** `agent_float_account_id` must be of `account_type = 'AGENT_FLOAT'` (provisioned in Phase 3 directory).

**Exit checks:** standard. Tests:
- Initiate → authorize → complete with right OTP → CRDT_TRF + COMPLETED
- Wrong OTP rejected, attempts counter increments durably
- Expired request: complete attempt fails
- Cancelled request: complete attempt fails
- Agent's float must be valid AGENT_FLOAT account, otherwise rejected at initiate

---

## B8.6 — Refunds

**Purpose.** Cryptographically linked to the original transaction. Beneficiary refunds the originator. Same flow as a normal credit transfer, with the original transaction reference embedded. The originator can verify the refund's link to the original via the cryptographic chain.

**Files to create.**
- `migrations/0041_refunds.sql`
- `modules/overlays-refunds/codes.js`
- `modules/overlays-refunds/schema.js`
- `modules/overlays-refunds/model.js`
- `modules/overlays-refunds/service.js`
- `modules/overlays-refunds/controller.js`
- `modules/overlays-refunds/routes.js`
- `modules/overlays-refunds/server.js` (port 4706)
- `modules/overlays-refunds/index.js`
- `modules/overlays-refunds/tests/refunds.test.js`

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS refunds (
  id                       UUID PRIMARY KEY,
  refund_number            TEXT UNIQUE NOT NULL,            -- 'REF-YYYYMM-NNNNNN'
  original_transaction_id  UUID NOT NULL REFERENCES transactions(id),
  refund_transaction_id    UUID REFERENCES transactions(id),
  initiated_by_participant TEXT NOT NULL,
  amount_minor             NUMERIC(38,0) NOT NULL,           -- can be partial of original
  currency                 CHAR(3) NOT NULL,
  reason_code              TEXT NOT NULL,
  reason_message           TEXT,
  state                    TEXT NOT NULL DEFAULT 'INITIATED', -- 'INITIATED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  link_signature_b64       TEXT NOT NULL,                    -- rail-signed (origTxId, refundTxId, amountMinor)
  link_signature_kid       TEXT NOT NULL,
  initiated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS refunds_orig_idx ON refunds(original_transaction_id);
```

**Refund reason codes (locked):**
- `CUSTOMER_REQUEST` — customer asked for refund
- `MERCHANT_GOODWILL` — merchant goodwill refund
- `OVERCHARGE` — wrong amount charged
- `SERVICE_NOT_RENDERED` — non-fraudulent dispute
- `OTHER`

**Constraints:**
- Amount can be ≤ original transaction amount (partial refunds allowed).
- Sum of refunds against an original transaction cannot exceed the original.
- Original transaction must be in `CONFIRMED` state (not REVERSED — that goes through disputes).
- 365-day window from original confirmation.

**Flow:**
1. Beneficiary's participant POSTs `/refunds` with original tx id + amount + reason.
2. Service validates: state, window, amount, total-refunds-cap.
3. Builds a `CRDT_TRF` envelope (beneficiary → originator), embeds `metadata.refund = { originalTxId, refundNumber }`.
4. Calls orchestrator. On confirmed, marks refund `COMPLETED`.
5. Rail signs the link `(origTxId, refundTxId, amountMinor)`. Originator can verify the chain.

**Disputes.** `REFUND_DUPLICATE` reason code added to Phase 7 taxonomy.

**Exit checks:** standard. Tests:
- Full refund → original tx still CONFIRMED, refund tx is its own CONFIRMED, link signature verifies
- Partial refund (50%) → succeeds, second 50% partial succeeds, third partial rejected
- Refund of REVERSED tx → rejected
- Outside-window refund → rejected
- Verify link signature with public key

---

## B8.7 — Escrow

**Purpose.** The rail holds money on behalf of two parties until a release condition is met (delivery confirmation, time elapsed, or signature from both). The rail acts as escrow agent. Useful for marketplaces, government tenders, large peer-to-peer transactions where trust is low.

**Files to create.**
- `migrations/0042_escrow_holds.sql`
- `modules/overlays-escrow/codes.js`
- `modules/overlays-escrow/states.js`
- `modules/overlays-escrow/schema.js`
- `modules/overlays-escrow/model.js`
- `modules/overlays-escrow/service.js`
- `modules/overlays-escrow/controller.js`
- `modules/overlays-escrow/routes.js`
- `modules/overlays-escrow/server.js` (port 4707)
- `modules/overlays-escrow/index.js`
- `modules/overlays-escrow/tests/escrow.test.js`
- **Patch:** `modules/ledger/codes.js` — add `RAIL_ESCROW` account type. The escrow accounts are seeded per currency by the seed script.

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS escrow_holds (
  id                       UUID PRIMARY KEY,
  escrow_number            TEXT UNIQUE NOT NULL,            -- 'ESC-YYYYMM-NNNNNN'
  payer_participant        TEXT NOT NULL,
  payer_account_id         UUID NOT NULL REFERENCES accounts(id),
  payee_participant        TEXT NOT NULL,
  payee_account_id         UUID NOT NULL REFERENCES accounts(id),
  amount_minor             NUMERIC(38,0) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  release_condition        TEXT NOT NULL,                    -- 'BOTH_SIGNATURES' | 'TIME_ELAPSED' | 'PAYER_RELEASE' | 'ARBITER_RELEASE'
  release_at               TIMESTAMPTZ,                       -- for TIME_ELAPSED
  arbiter_user_id          UUID REFERENCES users(id),         -- for ARBITER_RELEASE
  state                    TEXT NOT NULL DEFAULT 'INITIATED', -- 'INITIATED' | 'HELD' | 'RELEASED' | 'REFUNDED' | 'CANCELLED'
  hold_transaction_id      UUID REFERENCES transactions(id),
  release_transaction_id   UUID REFERENCES transactions(id),
  payer_signed_at          TIMESTAMPTZ,
  payee_signed_at          TIMESTAMPTZ,
  released_at              TIMESTAMPTZ,
  refunded_at              TIMESTAMPTZ,
  reason                   TEXT,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS escrow_state_idx ON escrow_holds(state);
CREATE INDEX IF NOT EXISTS escrow_release_due_idx ON escrow_holds(release_at) WHERE state = 'HELD' AND release_condition = 'TIME_ELAPSED';
```

**Release conditions:**
- `BOTH_SIGNATURES` — both payer and payee must sign release before money moves
- `TIME_ELAPSED` — auto-release at `release_at`
- `PAYER_RELEASE` — payer alone can release
- `ARBITER_RELEASE` — designated arbiter user resolves disputes

**Flow:**
1. Payer POSTs `/escrow` with payee, amount, condition. Service creates a hold-transfer envelope (payer → RAIL_ESCROW) via orchestrator. On confirmed, escrow state `HELD`.
2. Release per condition. Each release path produces a release-transfer envelope (RAIL_ESCROW → payee) via orchestrator. On confirmed, state `RELEASED`.
3. Refund (return to payer) follows the same pattern when the deal falls through. Audit-then-confirm rule: refund requires explicit operator confirmation unless the time-elapsed release condition is met for refund-to-payer flows.

**Time-elapsed worker.** Background worker checks `release_at` every 60s, auto-releases due holds.

**Disputes.** `ESCROW_RELEASE_DISPUTED` reason code added — payer claims goods not received but escrow released anyway.

**Exit checks:** standard. Tests:
- Hold → both-signature release → RELEASED with two journal entries (hold + release)
- Hold → time-elapsed release → RELEASED automatically by worker
- Hold → payer cancels before payee signs → REFUNDED
- Arbiter release: only the designated arbiter can call

---

## B8.8 — Split Payments + Phase 8 exit gate

**Purpose.** One debit, N atomic credits. A customer pays a marketplace; the marketplace, the seller, the delivery rider, and the platform fee all get their cut in one atomic operation.

**Files to create.**
- `migrations/0043_split_instructions.sql`
- `modules/overlays-split/codes.js`
- `modules/overlays-split/schema.js`
- `modules/overlays-split/model.js`
- `modules/overlays-split/service.js`
- `modules/overlays-split/controller.js`
- `modules/overlays-split/routes.js`
- `modules/overlays-split/server.js` (port 4708)
- `modules/overlays-split/index.js`
- `modules/overlays-split/tests/split.test.js`
- `scripts/demo-phase-8.sh`
- `tests/phase-8-overlays-e2e.test.js`

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS split_instructions (
  id                       UUID PRIMARY KEY,
  split_number             TEXT UNIQUE NOT NULL,
  payer_participant        TEXT NOT NULL,
  payer_account_id         UUID NOT NULL REFERENCES accounts(id),
  total_amount_minor       NUMERIC(38,0) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'INITIATED', -- 'INITIATED' | 'COMPLETED' | 'FAILED'
  reference                TEXT,
  master_transaction_id    UUID REFERENCES transactions(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS split_legs (
  id                       UUID PRIMARY KEY,
  split_id                 UUID NOT NULL REFERENCES split_instructions(id) ON DELETE RESTRICT,
  leg_index                INT NOT NULL,
  beneficiary_participant  TEXT NOT NULL,
  beneficiary_account_id   UUID NOT NULL REFERENCES accounts(id),
  amount_minor             NUMERIC(38,0) NOT NULL,
  description              TEXT,
  transaction_id           UUID REFERENCES transactions(id),
  result                   TEXT,
  UNIQUE (split_id, leg_index)
);

CREATE INDEX IF NOT EXISTS split_legs_split_idx ON split_legs(split_id);
```

**Atomicity.** All N legs commit or none do. Implementation: in a single `withTransaction`, ingest each envelope through the orchestrator. If any fails, the whole transaction rolls back. The orchestrator's existing transaction integrity guarantees this.

**Constraints:**
- Sum of leg amounts must equal `total_amount_minor`.
- Min legs: 2. Max legs: 50.
- All legs must be in same currency.
- All beneficiary accounts must be active.

**Disputes.** Split-specific dispute against any individual leg uses the standard reason codes; the leg's transaction is the dispute's target.

**`scripts/demo-phase-8.sh`** flow:
1. Setup: 4 participants active, 8 demo accounts (customer, merchant, agent, escrow demo accounts).
2. R2P: requester creates request → payer authorizes → CRDT_TRF confirmed.
3. Static QR: merchant generates → customer pays via decoded payload → CRDT_TRF confirmed.
4. Dynamic QR: merchant generates → customer pays once → second pay attempt rejected.
5. Mandate: customer creates DAILY mandate, scheduler triggers within 60s, debit confirmed.
6. Bulk: upload 10-line CSV → 10 transactions through orchestrator → 10 succeeded.
7. Cash-out: customer initiates → authorizes → presents OTP at agent → agent completes → CRDT_TRF confirmed.
8. Refund: refund 50% of one of the QR payments → linked refund transaction CONFIRMED.
9. Escrow: hold → BOTH_SIGNATURES → both sign → RELEASED.
10. Split: 4-way split (marketplace 70%, rider 20%, platform 5%, tax 5%) → all 4 transactions CONFIRMED atomically.
11. Print `PHASE 8 OK`.

**Phase 8 exit gate (paste output):**
- `bash scripts/demo-phase-8.sh` — prints `PHASE 8 OK`
- `pnpm vitest run` — all green; expect ~970+ total
- `pnpm lint`, `pnpm check-boundaries` — clean
- `pnpm reset && pnpm migrate && pnpm seed` — 43 migrations apply clean
- `git log --oneline | head -75` — shows 8 phase-8 commits

When this passes, Phase 8 is done. Stop. Wait for "continue to Phase 9."

---

## What "PHASE 8 OK" unlocks

After Phase 8:
- The rail has every overlay UPI and PIX have, plus escrow and split.
- Each overlay is ~300-500 LOC of overlay-specific logic on top of the existing primitives.
- Disputes work for every overlay because they all produce standard transactions.
- Phase 9 (cross-border) inherits the overlays — cross-border R2P, cross-border bulk, cross-border refunds all become natural extensions.
- Phase 10 ops console builds the merchant-facing and customer-facing UIs on top of these APIs.
