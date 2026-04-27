# Sika Rail — Specification

## What this is

Sika Rail is a national payment rail. There is nothing above it. Every bank, wallet, fintech, and PSP in the country plugs into it and pays every other through it. It owns:

- The directory of every account and alias in the country
- The message envelope that every payment uses
- The settlement positions between participants and the central bank
- The fraud engine that scores every transaction in real time
- The dispute machinery
- The cross-border legs to other rails (PAPSS, NIBSS, PesaLink, BIS Nexus)

If it goes down, payments in the country go down. The bar is therefore the same as a central bank's RTGS plus the modern features of UPI and PIX combined.

## What it must do

1. Accept payment instructions in any format (ISO 8583, ISO 20022, REST/JSON, SWIFT MT, file-based bulk) and translate to one canonical internal envelope
2. Resolve any alias (phone, email, Ghanacard PIN, merchant ID, custom handle) to an account
3. Confirm beneficiary name before money moves (Confirmation of Payee)
4. Move money atomically — either both legs commit or neither does
5. Run real-time settlement positions and run settlement cycles into central bank money
6. End each operating day with a clean cutover
7. Score every transaction for fraud in single-digit milliseconds
8. Run sanctions and watchlist screening on every leg
9. Detect network-wide fraud patterns (mule rings, structuring, coordinated attacks)
10. Run structured disputes with SLA enforcement and auto-debit on outcome
11. Provide overlay services: Request to Pay, QR (static + dynamic), recurring mandates, bulk payments, cash-out at agent, refunds, escrow, split payments
12. Handle cross-border natively — multi-currency, FX engine, atomic cross-border, travel rule, foreign rail registry
13. Stay up 24/7/365 with active-active across two data centers and rolling deploys
14. Stream the audit log to the regulator in real time
15. Expose a regulator console for direct queries
16. Onboard participants self-service through a portal with sandbox parity and certification suite

## Tenancy model

The rail is operated by a single central operator (BoG-mandated body). Every other actor — banks, wallet operators, fintechs, foreign rails — is a **participant**. Participants register accounts and aliases into the rail's directory. Customers don't talk to the rail directly; they talk to their participant's app, which talks to the rail.

This is **not** multi-tenant. There is one rail, one ledger, one directory. The rail is the source of truth for everyone.

## Architecture summary

**Monorepo, modular monolith.** One repo. One Postgres database. Modules under `modules/`. Each module has its own routes, can boot standalone via `node modules/<n>/server.js`, and is also mounted into the main `server.js` monolith.

**No microservices.** The rail can run as a monolith for years and still handle peak national load. Splitting comes later if and when proven necessary, and only at module boundaries that are already clean.

**No Redis. No Kafka. No queue server.** PostgreSQL is the queue (`SKIP LOCKED`). Hash-chained audit table is the event log. This is the same pattern that runs Sika main, Sika Collect, DocSeal — proven at scale, simple to operate.

**No ORM.** Raw SQL via `pg`. Every module's `model.js` holds its queries.

## Repo shape

```
sika-rail/
├── CLAUDE.md                    # rules for CC
├── SPEC.md                      # this file
├── PROGRESS.md                  # checkboxes — what's done, what's next
├── BLOCKERS.md                  # CC writes here when escalating
├── PHASES/
│   ├── PHASE-1.md               # foundation (block-by-block sign-off)
│   ├── PHASE-2.md               # written when phase 1 ends
│   └── ...
├── core/                        # primitives. Modules import from here. CC may not edit core/ from inside a module block.
│   ├── db.js                    # pg pool, withTransaction, withClient
│   ├── responses.js             # ok(), fail(), envelope shape
│   ├── errors.js                # AppError, error codes
│   ├── context.js               # req.ctx { user, participantId, requestId }
│   ├── baseCrud.js              # generic CRUD factory used by every module
│   ├── http.js                  # validateBody, validateQuery, asyncHandler
│   ├── money.js                 # BigInt money, currency math
│   ├── uuid.js                  # UUIDv7
│   ├── crypto.js                # Ed25519, AES-256-GCM, hash chain
│   └── config.js                # the only place that reads process.env
├── modules/
│   ├── auth/                    # phase 1
│   ├── audit/                   # phase 1
│   ├── crypto-keys/             # phase 1 — HSM-backed keys for participants
│   ├── envelope/                # phase 2 — canonical internal message envelope
│   ├── adapters/                # phase 2 — iso8583, iso20022, rest-json, swift-mt, bulk-file
│   ├── participants/            # phase 3
│   ├── directory/               # phase 3 — accounts
│   ├── aliases/                 # phase 3 — phone, email, ghanacard, merchant
│   ├── name-enquiry/            # phase 3 — incl. confirmation of payee
│   ├── transactions/            # phase 4 — authorization, idempotency
│   ├── routing/                 # phase 4
│   ├── credit-leg/              # phase 4 — beneficiary forwarding, atomicity
│   ├── reversals/               # phase 4
│   ├── ledger/                  # phase 5
│   ├── settlement/              # phase 5
│   ├── liquidity/               # phase 5
│   ├── eod/                     # phase 5
│   ├── reconciliation/          # phase 5
│   ├── fees/                    # phase 5
│   ├── fraud/                   # phase 6 — rules + ML scoring
│   ├── sanctions/               # phase 6
│   ├── network-graph/           # phase 6 — mule ring detection
│   ├── fast-track-reversal/     # phase 6 — PIX-MED equivalent
│   ├── disputes/                # phase 7
│   ├── overlays-r2p/            # phase 8
│   ├── overlays-qr/             # phase 8
│   ├── overlays-mandates/       # phase 8
│   ├── overlays-bulk/           # phase 8
│   ├── overlays-cashout/        # phase 8
│   ├── overlays-refunds/        # phase 8
│   ├── overlays-escrow/         # phase 8
│   ├── overlays-split/          # phase 8
│   ├── crossborder-rails/       # phase 9 — foreign rail registry
│   ├── crossborder-fx/          # phase 9
│   ├── crossborder-tx/          # phase 9 — atomic cross-border
│   ├── crossborder-travel-rule/ # phase 9
│   ├── ops-dashboard/           # phase 10
│   ├── regulator-console/       # phase 10
│   ├── public-status/           # phase 10
│   ├── ussd-gateway/            # phase 10
│   └── developer-portal/        # phase 10
├── migrations/                  # numbered SQL files, append-only
│   ├── 0001_init.sql
│   ├── 0002_audit.sql
│   └── ...
├── scripts/
│   ├── migrate.js               # runs migrations/ in order, idempotent
│   ├── seed.js                  # dev-only data
│   ├── reset.js                 # dev-only schema drop
│   ├── check-boundaries.js      # the anti-drift script. fails commit on violation.
│   └── demo-<flow>.js           # one per major end-to-end flow
├── server.js                    # monolith entry. Mounts every module's routes.
├── package.json                 # pnpm
└── .env.example
```

## Customizable name

The rail name (`Sika`, the central operator name, the ISO country code, branding strings) lives in `core/config.js`, sourced from env vars. Forking the codebase to a different country is a matter of changing env vars and running `pnpm migrate && pnpm seed`.

## Build phases

10 phases, ~80 blocks. Phase 1 is interactive (block-by-block sign-off). Phases 2–10 are autonomous (one master prompt per phase, CC self-drives to completion).

| Phase | Name | Blocks | What works at end of phase |
|---|---|---|---|
| 1 | Foundation | 10 | Repo runs. Migrations apply. Auth works. Audit log writes with hash chain. Response envelopes flow. BaseCRUD scaffolds anything. Boundary checker passes. Standalone module servers boot. |
| 2 | Message envelope & adapters | 8 | A payment instruction in ISO 8583, ISO 20022, REST/JSON, SWIFT MT, or bulk file becomes the same canonical internal envelope. Round-trips both ways. |
| 3 | Participant registry & directory | 8 | Onboard a participant. Register accounts. Register aliases (phone, email, Ghanacard, merchant). Name enquiry resolves any input to an account. Confirmation of Payee returns match/close/no-match. |
| 4 | Core transaction lifecycle | 12 | Authorize → route → credit leg → atomic outcome → idempotency → reversals. A real payment moves end to end with structured response codes. |
| 5 | Settlement, liquidity & EOD | 8 | Real-time positions, liquidity floors, settlement cycles (intraday + EOD), reconciliation, fee accrual. End of day cuts over cleanly. |
| 6 | Fraud & risk in line | 8 | Real-time scoring, sanctions, watchlists, network-graph detection, Confirmation of Payee tied in, fast-track fraud reversal (PIX-MED). |
| 7 | Disputes | 6 | File, adjudicate, auto-debit, customer transparency. Structured reason codes with SLAs enforced. |
| 8 | Overlay services | 8 | R2P, QR (static + dynamic), recurring mandates, bulk, cash-out at agent, refunds, escrow, split payments. |
| 9 | Cross-border native | 6 | Foreign rail registry, FX engine, atomic cross-border, travel rule, cross-border disputes, CBDC/stablecoin settlement leg. |
| 10 | Operations, observability, citizen access | 6 | Active-active deploys, ops dashboard, regulator console, public status page, USSD gateway, developer portal. |

## End state

A national rail equal to UPI on alias coverage, equal to PIX on overlay services, ahead of both on cross-border (because it's native), ahead of both on fraud (because it's network-graph + federated-ready), ahead of every African rail by a wide margin on every dimension.

Total estimated effort: ~80 blocks across 10 phases. Phase 1 takes ~2 weeks of careful work. Phases 2–10 each run autonomously in ~1–3 days of CC time per phase.

## Glossary

- **Participant** — bank, wallet operator, fintech, or PSP plugged into the rail
- **Operator** — the central body running the rail (BoG-designated)
- **Envelope** — the canonical internal message format, ISO 20022 semantics, JSON shape
- **Originator** — the participant whose customer is sending money
- **Beneficiary** — the participant whose customer is receiving money
- **Credit leg** — the rail's onward call to the beneficiary participant after authorization passes
- **Settlement position** — a participant's running net obligation with the rail since the last settlement cycle
- **Settlement cycle** — the moment net positions reset by moving central-bank money between participants
- **EOD** — end of day. The defined cutover when the day's books close.
- **R2P** — Request to Pay. Pull-style payment where the beneficiary asks and the payer authorizes.
- **CoP** — Confirmation of Payee. Pre-authorization check that the typed name matches the registered name on the destination account.
- **MED** (PIX terminology, adopted here) — Mecanismo Especial de Devolução. Fast-track fraud reversal for confirmed fraud within a defined window.
- **Travel rule** — FATF requirement that originator and beneficiary identifying info travel with cross-border payments.
- **PAPSS** — Pan-African Payment and Settlement System.
- **BIS Nexus** — global multilateral hub for instant cross-border payments.
Deferred items — known gaps, not regressions
These are known, intentional deferrals. They are not bugs. Each will be revived when a real participant or partner triggers the need.
ItemModuleDeferred fromNotesISO 8583 BCD bitmap encodingadapters-iso8583Phase 2 (B2.5)ASCII-hex bitmap shipped. Codec is parameterized. Add when a participant ships BCD wire.ISO 8583 EBCDIC character setadapters-iso8583Phase 2 (B2.5)Mainframe banks may need this. Codec is parameterized.Real NIA verificationaliasesPhase 3 (B3.5)Software fake ships in Phase 3. Real NIA adapter slots into the same interface when partnership is signed.Real HSM (PKCS#11)crypto-keysPhase 1 (B1.9)Software-backed AES-GCM custody ships. PKCS#11 adapter is a future block. Same interface.Production CA for participant certificatesparticipantsPhase 3 (B3.1)Self-signed CA in Phase 3. Real CA integration is operator-grade work per country.Federated learning for fraudfraudPhase 6 (deferred to v2)Centralized model in Phase 6. Federated training is a separate phase after launch.
When CC encounters a real-world need that requires one of these, it ESCALATES via BLOCKERS.md rather than building it on the fly.