# PHASE 7 — Disputes & Adjudication

**Mode:** Autonomous. Single master prompt, no per-block sign-off.

**Goal at end of phase:**
- A customer can raise a structured dispute through their participant against a confirmed transaction.
- Each dispute has a reason code with its own SLA window for filing and responding.
- Disputes flow through a state machine (filed → assigned → evidence-gathering → adjudicated → settled).
- Both sides upload evidence with cryptographic timestamping.
- Auto-resolution handles clear-cut cases (proven duplicates, expired-window filings, identity-mismatch refunds).
- Ambiguous cases route to human adjudicators with structured decision capture.
- Auto-debit on adjudicated outcome — money moves automatically once the case is upheld, via the conservative-reversal pattern (audit, then operator confirms unless the case is auto-resolved).
- A customer-facing case lookup portal lets the original raiser see real-time status and the SLA clock.
- A dispute reserve account holds the disputed amount until the case is settled.

**Why disputes matter despite Phase 6.** Fraud caught fraud at authorization — before money moved. Phase 7 catches everything else: customer-reported issues, post-confirmation fraud the algorithms missed, duplicates the idempotency window didn't catch, goods-not-received for QR merchant payments, regulatory direction reversals. The dispute pipeline is what makes the rail fair to the customer.

---

## What's in scope, what isn't

**In scope (Phase 7):**
- Dispute case state machine + structured reason codes
- Per-reason-code SLA windows (filing window + response window)
- Evidence upload with crypto timestamping
- Auto-resolution engine for clear-cut cases
- Manual adjudication workflow for ambiguous cases
- Auto-debit on outcome via the existing `reversals` flow
- Customer-facing case lookup portal (citizen API, no auth required, just case ID + originator phone/email)
- Dispute reserve account (hold the disputed amount during case)
- Dispute filing rate-limit per participant per customer

**NOT in scope (deferred):**
- Real adjudicator workforce management (queues, escalation by adjudicator skill) → Phase 10 ops console
- ML-driven dispute outcome prediction → Phase 11+
- Smart-contract conditional release on dispute outcome → frontier item, Phase 11+
- Cross-border dispute coordination with foreign rails → Phase 9
- Real SAR/STR filing automation to FIC-Ghana → Phase 10

---

## Architectural shape

```
                    ┌──────────────────────────────────┐
                    │   modules/disputes/               │
                    │   (case state machine + cases)    │
                    └───────┬─────────────────┬─────────┘
                            │                 │
              ┌─────────────▼──┐    ┌─────────▼──────────┐
              │   evidence      │    │   sla-clock         │
              │   (uploads,     │    │   (per-reason      │
              │   timestamped)  │    │    windows)         │
              └─────────────────┘    └─────────────────────┘
                            │                 │
              ┌─────────────▼──────────────────▼─────────┐
              │           adjudication                    │
              │   (auto-resolution + manual workflow)     │
              └───────────┬───────────────────────────────┘
                          │
              ┌───────────▼────────────┐
              │  dispute-settlement     │
              │  (audit → operator      │
              │   confirms reversal     │
              │   via existing module)  │
              └─────────────────────────┘
```

---

## Locked: dispute reason codes + SLA windows

These are exhaustive for Phase 7. CC must not invent more.

| Reason code | Description | Filing window | Response window | Auto-resolvable cases |
|---|---|---|---|---|
| `FRAUD` | Customer reports unauthorized transaction | 80 days from confirm | 5 business days | Confirmed by fast-track-reversal already → auto-uphold |
| `UNAUTHORIZED` | Customer says they didn't authorize but not specifically fraud | 60 days from confirm | 5 business days | None (always manual) |
| `DUPLICATE` | Two transactions with identical content | 90 days from confirm | 3 business days | Both transactions found in DB with same `(originator, amount, beneficiary, reference)` within 60s window → auto-uphold |
| `GOODS_NOT_RECEIVED` | Merchant payment, goods not delivered | 120 days from confirm | 7 business days | None |
| `WRONG_AMOUNT` | Amount sent ≠ amount intended (e.g. typo) | 30 days from confirm | 5 business days | None (always manual) |
| `WRONG_BENEFICIARY` | Sent to wrong account | 30 days from confirm | 5 business days | If beneficiary CoP returned `no-match` and customer overrode → auto-reject (customer overrode the warning); if CoP returned `match` and complaint → manual |
| `TECHNICAL` | Technical error (e.g. participant returned ACSC but no record) | 30 days from confirm | 3 business days | If reconciliation has a `STATUS_MISMATCH` break for this transaction → auto-uphold |
| `REGULATORY` | Court order, regulatory direction, FIC freeze | No window | 1 business day | None (always manual, regulator-only invocable) |

Locked in `modules/disputes/codes.js` with the exact same shape as `core/codes.js`.

---

## Locked: dispute case state machine

```
FILED  ─(auto-validation)─▶ ACCEPTED
FILED  ─(window expired)──▶ REJECTED                (terminal)
FILED  ─(rate-limit)──────▶ REJECTED                (terminal)

ACCEPTED ─(reserve held + evidence req sent)─▶ EVIDENCE_PENDING
ACCEPTED ─(auto-resolvable)──────────────────▶ AUTO_RESOLVED

EVIDENCE_PENDING ─(both sides submitted)─▶ ADJUDICATING
EVIDENCE_PENDING ─(response window expired)─▶ ADJUDICATING  (proceeds with one-sided evidence)

ADJUDICATING ─(decision uphold)──▶ UPHELD
ADJUDICATING ─(decision reject)──▶ DENIED                  (terminal)
ADJUDICATING ─(decision split)───▶ PARTIAL_UPHELD

AUTO_RESOLVED ─(audit written)──▶ SETTLED                  (terminal)
UPHELD ─(reversal_needed audit, operator confirms)─▶ SETTLED  (terminal)
PARTIAL_UPHELD ─(reversal_needed audit, partial reversal)─▶ SETTLED  (terminal)

ANY non-terminal ─(operator kill-switch)─▶ DENIED          (per kill-switch rule)
```

Terminal states: `REJECTED`, `DENIED`, `SETTLED`. From these, no further transitions.

---

## Locked: dispute reserve flow

When a case enters `ACCEPTED`, the rail moves the disputed amount from the originator's settlement position to a `RAIL_DISPUTE_RESERVE` account (Phase 5 already provisioned this account type). On `SETTLED-with-uphold`, the reserve flows to the originator (the customer gets refunded). On `DENIED` or `SETTLED-with-reject`, the reserve flows back to the beneficiary.

This means every Phase 7 case posts at least 2 ledger journals: one at `ACCEPTED` (reserve hold), one at `SETTLED` (reserve release). Both inside the standard `withTransaction` pattern.

```
ACCEPTED:
  DR PARTICIPANT_SETTLEMENT(beneficiary)  amount     // beneficiary's claim is held
  CR RAIL_DISPUTE_RESERVE                 amount

SETTLED + uphold:
  DR RAIL_DISPUTE_RESERVE                 amount
  CR PARTICIPANT_SETTLEMENT(originator)   amount     // originator gets refunded

SETTLED + reject:
  DR RAIL_DISPUTE_RESERVE                 amount
  CR PARTICIPANT_SETTLEMENT(beneficiary)  amount     // beneficiary keeps it
```

---

## B7.1 — Dispute foundation: cases, reason codes, SLA windows

**Purpose.** The disputes table, state machine, reason code registry with SLA windows, and the public surface that participants call to file disputes.

**Files to create.**
- `migrations/0033_disputes.sql`
- `modules/disputes/codes.js`           — locked SLA windows table
- `modules/disputes/states.js`          — locked state machine
- `modules/disputes/schema.js`
- `modules/disputes/model.js`
- `modules/disputes/service.js`
- `modules/disputes/controller.js`
- `modules/disputes/routes.js`
- `modules/disputes/server.js` (port 4601, key `disputesPort`)
- `modules/disputes/index.js`
- `modules/disputes/tests/foundation.test.js`

**`migrations/0033_disputes.sql`:**

```sql
CREATE TABLE IF NOT EXISTS dispute_cases (
  id                       UUID PRIMARY KEY,
  case_number              TEXT UNIQUE NOT NULL,             -- 'DSP-202604-000001' format, sequential per month
  transaction_id           UUID NOT NULL REFERENCES transactions(id),
  reason_code              TEXT NOT NULL,
  filing_participant       TEXT NOT NULL REFERENCES participants(code),
  filing_user_ref          TEXT,                              -- the participant's customer ref (opaque to rail)
  amount_minor             NUMERIC(38,0) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'FILED',
  filed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at              TIMESTAMPTZ,
  evidence_pending_until   TIMESTAMPTZ,
  adjudicating_at          TIMESTAMPTZ,
  resolved_at              TIMESTAMPTZ,
  outcome                  TEXT,                              -- 'UPHOLD' | 'REJECT' | 'PARTIAL'
  outcome_amount_minor     NUMERIC(38,0),                    -- for PARTIAL
  outcome_notes            TEXT,
  reserve_journal_id       UUID REFERENCES ledger_journal(id),
  release_journal_id       UUID REFERENCES ledger_journal(id),
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispute_cases_tx_idx ON dispute_cases(transaction_id);
CREATE INDEX IF NOT EXISTS dispute_cases_state_idx ON dispute_cases(state);
CREATE INDEX IF NOT EXISTS dispute_cases_reason_idx ON dispute_cases(reason_code);
CREATE INDEX IF NOT EXISTS dispute_cases_filing_idx ON dispute_cases(filing_participant);
CREATE INDEX IF NOT EXISTS dispute_cases_pending_evidence_idx ON dispute_cases(state, evidence_pending_until)
  WHERE state = 'EVIDENCE_PENDING';

CREATE TABLE IF NOT EXISTS dispute_status_history (
  id                  UUID PRIMARY KEY,
  case_id             UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  from_state          TEXT,
  to_state            TEXT NOT NULL,
  reason              TEXT,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurred_by         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS dispute_history_case_idx ON dispute_status_history(case_id);
```

**Filing rate limit.** A participant cannot file more than 100 disputes per 24h per customer-ref (`filing_user_ref`). Counter durability via separate connection, like the OTP attempts in Phase 3. Returns `RATE_LIMITED` rejection.

**Case-number generator.** `DSP-{YYYYMM}-{seq}`, where `seq` is a monthly sequence (resets each month). Implemented with a `dispute_case_sequence` table that's row-locked on increment, single round-trip.

**Service API:**

```js
file({ transactionId, reasonCode, filingParticipant, filingUserRef, evidence, amountOverride })
listForParticipant(filingParticipant, { state, reasonCode, limit, offset })
listForTransaction(transactionId)
findByCaseNumber(caseNumber)
transition(client, caseId, toState, { reason, payload, occurredBy })
```

**Routes (mTLS required for participant routes):**
- `POST /disputes` — file (participant)
- `GET /disputes` — list (admin)
- `GET /disputes/:caseNumber` — fetch
- `GET /disputes/transaction/:txId` — list for transaction
- `POST /disputes/:id/kill` — admin kill-switch

**Window validation at filing.** Compare `now() - transactions.confirmed_at` against the reason code's `fileWithinDays`. If exceeded → reject with `WINDOW_EXPIRED`. `REGULATORY` reason has no window.

**Exit checks:** standard. Tests:
- File a valid case → state `FILED`
- File outside window → rejected with `WINDOW_EXPIRED`
- File on non-confirmed transaction → rejected
- Rate limit: 101st filing in 24h same user → rejected
- Case number format and monotonicity per month
- Audit `dispute.filed`, `dispute.window_expired`, `dispute.rate_limited`

---

## B7.2 — Auto-validation, accept, dispute reserve hold

**Purpose.** When a case is `FILED`, run auto-validation (window, rate limit, transaction state). If valid, transition to `ACCEPTED`, hold the disputed amount in `RAIL_DISPUTE_RESERVE`, and start the SLA clock for the response window.

**Files to create.**
- `modules/disputes/auto-validator.js`     — runs validation rules
- `modules/disputes/reserve-holder.js`     — posts the reserve-hold journal
- `modules/disputes/sla-clock.js`          — starts response window
- (extends existing `service.js` with `processFiled(caseId)`)
- `modules/disputes/tests/accept.test.js`

**`processFiled(caseId)` flow:**
1. Run auto-validator: window check, rate limit, transaction state check, idempotency (already filed for same tx + reason in last 24h).
2. If invalid → transition to `REJECTED` with reason. Audit `dispute.rejected_filing`.
3. If valid → transition to `ACCEPTED` in same transaction:
   - Post the reserve-hold ledger journal (`DR PARTICIPANT_SETTLEMENT(beneficiary), CR RAIL_DISPUTE_RESERVE`)
   - Set `evidence_pending_until = now() + responseWindowDays`
   - Send evidence-request notification to the **beneficiary** participant via webhook (audit `dispute.evidence_requested` for now; real webhook delivery is Phase 10 deferred)
   - Audit `dispute.accepted`

**Auto-resolve check.** After `ACCEPTED`, immediately check if the case is auto-resolvable per its reason code's auto-resolution criteria (locked in B7.1's table). If yes, route to B7.4's auto-resolution engine. If no, transition to `EVIDENCE_PENDING`.

**Function signature enforcement.** `reserveHolder.holdAmount(client, { caseId, amountMinor, currency })` requires the case to be in state `ACCEPTED` and that no prior `reserve_journal_id` exists. Idempotent.

**Exit checks:** standard. Tests:
- Valid filing → ACCEPTED + reserve held
- Reserve journal balances correctly
- Beneficiary's settlement position decreases by amount
- RAIL_DISPUTE_RESERVE balance increases by amount
- Auto-resolvable case (e.g. proven DUPLICATE) routes to AUTO_RESOLVED path
- Idempotency: re-running processFiled on already-ACCEPTED case is a no-op

---

## B7.3 — Evidence upload + cryptographic timestamping

**Purpose.** Both sides (filing participant and responding participant) upload evidence to the case. Evidence is cryptographically timestamped at upload — the timestamp can later be proven to have existed on the rail at upload time, which is critical for adjudication.

**Files to create.**
- `migrations/0034_dispute_evidence.sql`
- `modules/disputes/evidence-model.js`
- `modules/disputes/evidence-service.js`
- `modules/disputes/evidence-controller.js`
- (extends existing `routes.js`)
- `modules/disputes/tests/evidence.test.js`

**`migrations/0034_dispute_evidence.sql`:**

```sql
CREATE TABLE IF NOT EXISTS dispute_evidence (
  id                  UUID PRIMARY KEY,
  case_id             UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  side                TEXT NOT NULL,                    -- 'FILER' | 'RESPONDER' | 'OPERATOR'
  uploaded_by_participant TEXT,                          -- null for OPERATOR
  uploaded_by_user    UUID REFERENCES users(id),
  evidence_type       TEXT NOT NULL,                    -- 'DOCUMENT' | 'STATEMENT' | 'TRANSACTION_LOG' | 'COMMUNICATION' | 'OTHER'
  filename            TEXT NOT NULL,
  content_sha256      TEXT NOT NULL,
  content_size_bytes  BIGINT NOT NULL,
  mime_type           TEXT,
  description         TEXT,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- cryptographic timestamping
  rail_timestamp      TIMESTAMPTZ NOT NULL DEFAULT now(),
  rail_signature_b64  TEXT NOT NULL,                    -- rail signs (caseId, sha256, timestamp)
  rail_signature_kid  TEXT NOT NULL,
  -- provenance chain (linked-list per case for tamper detection)
  prev_evidence_hash  TEXT NOT NULL,                    -- empty string for first piece per case
  evidence_chain_hash TEXT NOT NULL                     -- sha256(prev_evidence_hash || sha256(evidence_metadata))
);

CREATE INDEX IF NOT EXISTS evidence_case_idx ON dispute_evidence(case_id);
CREATE INDEX IF NOT EXISTS evidence_uploaded_at_idx ON dispute_evidence(uploaded_at);
```

**Storage policy.** Same as Phase 3 KYB documents: store filename + SHA-256 + size only. Real bytes are hashed and discarded. Real object storage is Phase 10 deferred.

**Cryptographic timestamping.** At upload, the rail signs `canonicalJson({caseId, contentSha256, uploadedAt, side, evidenceType})` with its active Ed25519 key. The signature + kid + signed-at-timestamp travel with the evidence row. A participant can later prove "this evidence existed on the rail at this time" by presenting the row + the rail's public key.

**Provenance chain.** Each piece of evidence within a case links to the previous one via `prev_evidence_hash`, just like the audit log's daily chain. Lets us prove no evidence was inserted retroactively or removed.

**Service API:**

```js
upload(client, { caseId, side, uploadedByParticipant, uploadedByUser, file, description })
listForCase(caseId, { side })
verifyChain(caseId) -> { ok: true } | { ok: false, brokenAtId }
```

**Routes:**
- `POST /disputes/:caseNumber/evidence` — multipart upload via `express-fileupload`
- `GET /disputes/:caseNumber/evidence` — list (case visible to both sides + operator)
- `GET /disputes/:caseNumber/evidence/:id/verify-signature` — public verify endpoint (returns the signed payload + signature for external verification)

**Auto-progress.** When both sides have uploaded at least one piece of evidence, the case auto-transitions from `EVIDENCE_PENDING` to `ADJUDICATING`. When the response window expires, the case transitions to `ADJUDICATING` regardless. Either path writes `dispute.evidence_complete` audit.

**Exit checks:** standard. Tests:
- Upload from filer, upload from responder → case auto-progresses to ADJUDICATING
- Window expiration auto-progresses
- Evidence chain hash links correctly across multiple uploads
- Tamper detection: mutate one row's content_sha256, verifyChain returns `ok: false`
- Signature verifiable using rail's public key

---

## B7.4 — Adjudication: auto-resolution + manual workflow

**Purpose.** Two paths from `ADJUDICATING`. Auto-resolution for cases with deterministic outcomes (defined per reason code in B7.1). Manual workflow for everything else, with structured decision capture.

**Files to create.**
- `modules/disputes/auto-resolver.js`
- `modules/disputes/auto-resolver-rules/r-fraud.js`         — uphold if fast-track-reversal already completed
- `modules/disputes/auto-resolver-rules/r-duplicate.js`     — uphold if duplicate transaction found in 60s window
- `modules/disputes/auto-resolver-rules/r-technical.js`     — uphold if reconciliation has STATUS_MISMATCH for this tx
- `modules/disputes/auto-resolver-rules/r-wrong-beneficiary.js` — reject if customer overrode CoP no-match warning
- `modules/disputes/manual-workflow.js`
- `modules/disputes/decision-model.js`
- `modules/disputes/decision-service.js`
- `modules/disputes/decision-controller.js`
- (extends `routes.js`)
- `modules/disputes/tests/adjudication.test.js`

**`migrations/0035_dispute_decisions.sql`:**

```sql
CREATE TABLE IF NOT EXISTS dispute_decisions (
  id                  UUID PRIMARY KEY,
  case_id             UUID UNIQUE NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  decision_type       TEXT NOT NULL,                    -- 'AUTO' | 'MANUAL'
  outcome             TEXT NOT NULL,                    -- 'UPHOLD' | 'REJECT' | 'PARTIAL'
  outcome_amount_minor NUMERIC(38,0),                   -- for PARTIAL
  rationale_code      TEXT NOT NULL,                    -- structured rationale, e.g. 'AUTO_FRAUD_FASTTRACK_COMPLETED'
  rationale_notes     TEXT,
  decided_by_user     UUID REFERENCES users(id),        -- null for AUTO
  decided_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_considered JSONB                              -- snapshot of evidence IDs at decision time
);
```

**Auto-resolver flow:**
1. Load the case + transaction + evidence.
2. Look up the resolver function for the reason code from a registry (`auto-resolver-rules/`).
3. Run it. If it returns `{ resolvable: true, outcome, rationaleCode, outcomeAmountMinor? }` → apply. If `{ resolvable: false }` → fall through to manual.
4. On apply: write the `dispute_decisions` row with `decision_type = 'AUTO'`, transition case state, write audit `dispute.auto_resolved`.

**Manual workflow:**
- `POST /disputes/:caseNumber/decisions` body `{outcome, rationaleCode, rationaleNotes, outcomeAmountMinor?}` — admin only (operator/adjudicator).
- Service validates: case is in `ADJUDICATING`, no existing decision, rationale code is from a fixed taxonomy (reject unknown codes).
- Writes decision row with `decision_type = 'MANUAL'`, transitions case state.

**Manual rationale code taxonomy** (locked):
- `EVIDENCE_INSUFFICIENT` — neither side proved enough
- `EVIDENCE_FAVORS_FILER` — filer's evidence stronger
- `EVIDENCE_FAVORS_RESPONDER` — responder's evidence stronger
- `OPERATIONAL_ERROR_CONFIRMED` — clear technical/operational fault
- `REGULATORY_DIRECTION` — court order, regulator instruction
- `CUSTOMER_BEHAVIOR_CONTRIBUTED` — customer's actions partially contributed
- `BENEFICIARY_REFUND_VOLUNTARY` — beneficiary refunded voluntarily

State transitions from decision:
- `UPHOLD` → `UPHELD`
- `REJECT` → `DENIED`
- `PARTIAL` → `PARTIAL_UPHELD`

**Exit checks:** standard. Tests:
- Auto-resolver: DUPLICATE with matching second tx → UPHOLD
- Auto-resolver: TECHNICAL with reconciliation break → UPHOLD
- Auto-resolver: WRONG_BENEFICIARY where customer overrode CoP → REJECT (auto-deny)
- Auto-resolver: complex case (not in lookup) → falls through to manual
- Manual decision: valid rationale code accepted, invalid rejected
- Single-decision-per-case enforced (UNIQUE constraint)

---

## B7.5 — Settlement on outcome: audit-then-confirm

**Purpose.** Once a case has a decision (`UPHELD`, `PARTIAL_UPHELD`, or `DENIED`), money has to move. Per the conservative-reversal rule, money movement requires explicit confirmation — except for auto-resolved cases, which are pre-validated by the auto-resolver and proceed without an additional confirmation step.

**Files to create.**
- `modules/disputes/settlement-service.js`
- `modules/disputes/settlement-controller.js`
- (extends `routes.js`)
- `modules/disputes/tests/settlement.test.js`

**Flow:**

For `AUTO_RESOLVED` cases:
1. The auto-resolver's apply step also writes the audit and transitions to `SETTLED`.
2. In the same transaction, post the reserve-release ledger journal:
   - `UPHOLD` → `DR RAIL_DISPUTE_RESERVE, CR PARTICIPANT_SETTLEMENT(originator)` (refund to filer's customer's participant)
   - `REJECT` → `DR RAIL_DISPUTE_RESERVE, CR PARTICIPANT_SETTLEMENT(beneficiary)` (return to beneficiary's participant)
3. For `UPHOLD` outcomes, also call `reversals.initiate({ originalTxId, reasonCode: 'CUST', ... })` to mark the original transaction as `REVERSED`.

For `UPHELD`, `PARTIAL_UPHELD`, `DENIED` (manual):
1. The decision step transitions the case state but does **not** post the release journal. Instead writes audit `dispute.reversal_needed` (per conservative rule).
2. Operator (or future automated subscriber) calls `POST /disputes/:caseNumber/confirm-settlement`.
3. Service validates: state is in {`UPHELD`, `PARTIAL_UPHELD`, `DENIED`}, no existing `release_journal_id`, confirmation user differs from the decision user (maker-checker).
4. Posts the release journal in the same transaction as the state transition to `SETTLED`.
5. For `UPHELD`/`PARTIAL_UPHELD`, also calls `reversals.initiate()`.

**`PARTIAL_UPHELD` math.** The reserve was held for the full amount. On partial uphold (e.g. 60% to filer, 40% to beneficiary):
- `DR RAIL_DISPUTE_RESERVE: amount`
- `CR PARTICIPANT_SETTLEMENT(originator): outcome_amount_minor` (the upheld portion)
- `CR PARTICIPANT_SETTLEMENT(beneficiary): amount - outcome_amount_minor` (the rejected portion)

Three-leg journal, balances per the standard ledger rule.

**Audit chain:**
- `dispute.decided` (decision posted)
- `dispute.reversal_needed` (waiting for confirmation, manual path only)
- `dispute.settled` (release journal posted, terminal)

**Exit checks:** standard. Tests:
- Auto-resolved UPHOLD: settles atomically, original tx becomes REVERSED, originator gets refunded
- Auto-resolved REJECT: settles atomically, beneficiary keeps it
- Manual UPHELD: decision posted, audit written, no journal yet
- Manual confirm-settlement: maker-checker enforced (same user can't confirm own decision)
- Manual confirm-settlement after UPHELD: refund posted, original tx REVERSED
- PARTIAL_UPHELD: three-leg journal balances, both sides receive their portions
- Idempotency: re-confirming a SETTLED case is a no-op

---

## B7.6 — Customer-facing case lookup + Phase 7 exit gate

**Purpose.** The customer who raised the dispute can look up their case in real time. SLA clock visible. Status visible. Their own evidence visible. No auth — just case number plus a verification token (the customer's email or phone fingerprint that was registered at filing).

**Files to create.**
- `modules/disputes/customer-portal-service.js`
- `modules/disputes/customer-portal-controller.js`
- (extends `routes.js` with `/disputes/portal/:caseNumber` routes)
- `scripts/demo-phase-7.sh`
- `tests/phase-7-disputes-e2e.test.js`

**Verification token scheme.** At filing, the participant supplies `filing_user_ref` (their internal customer ref) **and** a `verification_fingerprint` — a SHA-256 hash of `(participant.code + customer's verified phone or email)`. The fingerprint travels with the case but is never readable by the rail or other participants. Customer-portal access requires the fingerprint to match.

**Public-facing routes (no auth, rate-limited per IP):**
- `GET /disputes/portal/:caseNumber?fingerprint=<hash>` — returns case status + SLA clock + customer's own evidence pieces (not the responder's)
- `POST /disputes/portal/:caseNumber/comments?fingerprint=<hash>` — customer adds a comment

**Rate limits.** 30 requests per IP per minute per endpoint; counter durability via separate connection pattern.

**SLA clock display.** Case has `evidence_pending_until` and `expected_decision_by` fields exposed to the portal. Clock counts down. After expiry the portal shows the clock hit zero but the case proceeds to `ADJUDICATING`.

**`scripts/demo-phase-7.sh`** flow:
1. Setup: 3 participants active, demo customer in BANK01, simulator includes force-resolve accounts (`9999000020` triggers DUPLICATE auto-resolve, `9999000021` triggers TECHNICAL auto-resolve).
2. Run a normal CONFIRMED transaction.
3. File a `DUPLICATE` dispute against it (with the simulator's matching second-transaction fixture). Auto-resolver fires. Case → `AUTO_RESOLVED` → `SETTLED`. Original tx → `REVERSED`. Originator's settlement position credited.
4. Run another transaction. File a `GOODS_NOT_RECEIVED` dispute. Case → `ACCEPTED` → `EVIDENCE_PENDING`.
5. Upload evidence from both sides. Case → `ADJUDICATING`.
6. Operator submits manual decision `UPHOLD` with rationale `EVIDENCE_FAVORS_FILER`. Case → `UPHELD`. Audit `dispute.reversal_needed` written.
7. Different operator confirms settlement. Case → `SETTLED`. Refund posted. Original tx → `REVERSED`.
8. File a `WRONG_BENEFICIARY` dispute on a transaction where the customer had overrode CoP no-match. Auto-resolver fires REJECT. Case → `AUTO_RESOLVED` → `SETTLED` with beneficiary keeping the funds.
9. Hit the customer portal with the fingerprint, verify case status visible.
10. Hit the customer portal with wrong fingerprint, verify rejection.
11. Print `PHASE 7 OK`.

**Phase 7 exit gate (paste output):**
- `bash scripts/demo-phase-7.sh` — prints `PHASE 7 OK`
- `pnpm vitest run` — all green; expect ~830+ total
- `pnpm lint`, `pnpm check-boundaries` — clean
- `pnpm reset && pnpm migrate && pnpm seed` — 35 migrations apply clean
- `git log --oneline | head -65` — shows 6 phase-7 commits

When this passes, Phase 7 is done. Stop. Wait for "continue to Phase 8."

---

## What "PHASE 7 OK" unlocks

After Phase 7:
- Customers can dispute confirmed transactions through structured reason codes with proper SLA windows.
- Auto-resolution handles the obvious cases without human intervention.
- Manual adjudication has structured rationale codes, evidence chains, and maker-checker on settlement.
- The dispute reserve account holds funds during cases — protects the rail from double-spending the disputed amount.
- Cryptographic evidence timestamping makes the rail's adjudication defensible to regulators.
- The customer portal closes the trust gap between the customer and the dispute outcome.
- Phase 8 (overlays) plug into the existing dispute pipeline — R2P, QR, mandates, and refunds all use the same case state machine and reason codes.
- Phase 9 (cross-border) inherits the dispute pipeline with foreign-rail-coordinated dispute extensions.
- Phase 10 (ops console) builds the adjudicator UI on top of the existing case + evidence + decision tables.
