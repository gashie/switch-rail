# Sika Rail — Progress

CC ticks `[ ]` to `[x]` itself when a block is committed. This file is the source of truth for what's done.

---

## Phase 1 — Foundation (block-by-block sign-off)

Active phase. Spec: `PHASES/PHASE-1.md`.

- [x] B1.1 — Repo init, package.json, scripts, .env.example, README
- [x] B1.2 — `core/db.js` (pg pool, withClient, withTransaction) + migration runner
- [x] B1.3 — `core/responses.js`, `core/errors.js`, `core/context.js`, `core/http.js`
- [x] B1.4 — `core/money.js` (BigInt money + currency), `core/uuid.js` (UUIDv7)
- [x] B1.5 — `core/crypto.js` (Ed25519, AES-256-GCM, hash chain) + `core/config.js`
- [x] B1.6 — `core/baseCrud.js` (generic CRUD factory)
- [x] B1.7 — `modules/auth/` (cookie sessions, login, password hash with argon2, mTLS-ready)
- [x] B1.8 — `modules/audit/` (append-only event log with daily hash chain)
- [x] B1.9 — `modules/crypto-keys/` (HSM-backed key custody for participants — Ed25519 keypairs)
- [x] B1.10 — `scripts/check-boundaries.js` (anti-drift script) + `server.js` monolith assembly + Phase 1 exit gate

---

## Phase 2 — Message envelope & adapters (autonomous)

Spec: written when Phase 1 ends.

- [x] B2.1 — Canonical envelope schema (Joi) + `modules/envelope/`
- [x] B2.2 — Envelope persistence (table, model, idempotency-aware insert)
- [x] B2.3 — REST/JSON adapter (in/out)
- [x] B2.4 — ISO 20022 adapter (pacs.008, pacs.002, pacs.004 — XML to envelope and back)
- [x] B2.5 — ISO 8583 adapter (1987/1993/2003 variants — bitmap parsing to envelope and back)
- [x] B2.6 — SWIFT MT adapter (MT103, MT202)
- [x] B2.7 — Bulk file adapter (CSV, XLSX, pain.001 — line-by-line to envelopes)
- [x] B2.8 — Phase 2 exit gate: round-trip tests for every format

---

## Phase 3 — Participant registry & directory (autonomous)

- [x] B3.1 — `modules/participants/` (registration, certs, endpoints, status)
- [x] B3.2 — Participant onboarding workflow (KYB, certification, go-live gate)
- [x] B3.3 — `modules/directory/` (accounts table — bank_id+account_number, wallet operator+msisdn)
- [x] B3.4 — `modules/aliases/` (one alias → one account; many aliases per account)
- [x] B3.5 — Alias verification flows (phone OTP, email link, Ghanacard NIA hook, merchant TIN)
- [x] B3.6 — Alias portability across PSPs
- [x] B3.7 — `modules/name-enquiry/` (resolve input → account; mask beneficiary name)
- [x] B3.8 — Confirmation of Payee (fuzzy match scoring, match/close/no-match return) + Phase 3 exit gate

---

## Phase 4 — Core transaction lifecycle (autonomous)

- [x] B4.1 — `modules/transactions/` (envelope ingestion, idempotency)
- [x] B4.2 — Authorization pipeline (limits, status, sanctions stub, fraud stub, liquidity stub)
- [x] B4.3 — Structured response code taxonomy (success/retryable/terminal/ambiguous)
- [x] B4.4 — `modules/routing/` (BIN routing, hot reload)
- [x] B4.5 — Multi-rail orchestration (GIP/MMI/ACH path selection)
- [x] B4.6 — `modules/credit-leg/` (forward to beneficiary, timeout enforcement)
- [x] B4.7 — Atomic outcome (debit + credit commit-or-rollback in one transaction)
- [x] B4.8 — Recovery state (timeout retry, escalation, eventual reversal)
- [x] B4.9 — Confirmation flow (cryptographic receipts to both sides)
- [x] B4.10 — `modules/reversals/` (linked unwinds, return reason codes)
- [x] B4.11 — End-to-end demo script: domestic P2P payment in REST format
- [x] B4.12 — Phase 4 exit gate: same demo runs in ISO 8583 and ISO 20022

---

## Phase 5 — Settlement, liquidity & EOD (autonomous)

- [x] B5.1 — `modules/ledger/` (double-entry, hash-chained, BigInt, multi-currency)
- [x] B5.2 — `modules/settlement/` (real-time positions per participant)
- [x] B5.3 — `modules/liquidity/` (floors, ceilings, throttle/block on floor breach, prefunding top-up)
- [x] B5.4 — Settlement cycles (intraday net cycles, RTGS-linked high-value, programmable windows)
- [x] B5.5 — `modules/eod/` (cutover, settlement report generation, snapshot, hash freeze, day rollover)
- [x] B5.6 — `modules/reconciliation/` (continuous + EOD recon, exception queue)
- [x] B5.7 — `modules/fees/` (per-class fee schedules, accrual at authorization, settlement netting)
- [x] B5.8 — Phase 5 exit gate: full day simulation with multiple cycles + EOD

---

## Phase 6 — Fraud & risk in line (autonomous)

- [x] B6.1 — `modules/fraud/` (rules engine: velocity, geo, time, amount, new-beneficiary)
- [x] B6.2 — Behavioral baselines per account
- [x] B6.3 — ML scoring hook (model interface, feature extractor; model itself is plugin)
- [x] B6.4 — `modules/sanctions/` (OFAC, UN, EU, BoG, FIC lists; PEP screening)
- [x] B6.5 — `modules/network-graph/` (mule ring detection, structuring, coordinated attacks)
- [x] B6.6 — Cross-participant fraud signal exchange
- [x] B6.7 — `modules/fast-track-reversal/` (PIX-MED equivalent — defined-window fraud clawback)
- [x] B6.8 — Phase 6 exit gate: fraud demo script catches simulated mule ring

---

## Phase 7 — Disputes (autonomous)

- [x] B7.1 — `modules/disputes/` (case state machine, structured reason codes)
- [x] B7.2 — Per-reason SLA enforcement with auto-uphold on timeout
- [x] B7.3 — Evidence upload with cryptographic timestamping
- [x] B7.4 — Adjudication engine (auto for clear-cut, route to human for ambiguous)
- [x] B7.5 — Auto-debit on outcome (settlement integration)
- [x] B7.6 — Customer-facing case lookup + Phase 7 exit gate

---

## Phase 8 — Overlay services (autonomous)

- [x] B8.1 — `modules/overlays-r2p/` (Request to Pay, payer authorization)
- [x] B8.2 — `modules/overlays-qr/` (EMVCo static + dynamic QR)
- [x] B8.3 — `modules/overlays-mandates/` (recurring with caps, instant revoke)
- [x] B8.4 — `modules/overlays-bulk/` (millions of lines, per-line response)
- [x] B8.5 — `modules/overlays-cashout/` (agent cash-out flow)
- [x] B8.6 — `modules/overlays-refunds/` (cryptographically linked to original)
- [x] B8.7 — `modules/overlays-escrow/` (hold + conditional release)
- [x] B8.8 — `modules/overlays-split/` (one debit, N atomic credits) + Phase 8 exit gate

---

## Phase 9 — Cross-border native (autonomous)

- [x] B9.1 — `modules/crossborder-rails/` (foreign rail registry — NIBSS, PesaLink, TIPS, PAPSS, BIS Nexus)
- [x] B9.2 — `modules/crossborder-fx/` (multi-currency, FX quotes, rate lock, slippage)
- [x] B9.3 — Cross-border envelope extension (currency, FX, country codes, travel rule fields)
- [x] B9.4 — `modules/crossborder-tx/` (atomic two-leg via PvP coordinator pattern)
- [x] B9.5 — `modules/crossborder-travel-rule/` (FATF originator/beneficiary info enforcement)
- [x] B9.6 — Cross-border disputes + CBDC/stablecoin settlement leg + Phase 9 exit gate

---

## Phase 10 — UI: operator + participant + citizen (autonomous)

- [x] B10.1 — Design tokens, Tailwind preset, fonts, format helpers, status map, workspace
- [x] B10.2 — Component library part 1 (12 primitives)
- [x] B10.3 — Component library part 2 (composites + RTK Query slices)
- [x] B10.4 — Operator app shell + Transactions reference page
- [x] B10.5 — Operator dashboard + fraud + network graph + rule packs
- [x] B10.6 — Operator settlement + EOD + reconciliation + ledger + liquidity
- [x] B10.7 — Operator disputes + fast-track + reversals
- [x] B10.8 — Operator cross-border + FX + foreign rails + travel rule
- [ ] B10.9 — Participant Portal app
- [ ] B10.10 — Citizen status app + ops-dashboard + regulator-console + public-status + ussd-gateway
- [ ] B10.11 — Developer Portal + OpenAPI generator
- [ ] B10.12 — Phase 10 exit gate (demo + Lighthouse)

---

## Status

- **Current phase:** 10 — UI (in progress)
- **Current block:** B10.5 done — Dashboard/Fraud (cases+rules+sanctions tabs)/Network graph/Participants pages wired to RTK Query
- **Tests passing:** 853 (779 backend + 74 ui/shared)
- **Migrations applied:** 48
