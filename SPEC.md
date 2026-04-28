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

Append these to the deferred-items table:
ItemModuleDeferred fromNotesNIA live adapteraliasesPhase 3mode='fake' ships. mode='live' throws. Real adapter slots into the same niaClient.verify interface.OTP live provider (SMS gateway)aliasesPhase 3Fake hands the code back to the caller for dev demos. Real provider delivers via SMS and stores hashed secret only.Email-link live provider (SMTP)aliasesPhase 3Same pattern.KYB document object storageparticipant-onboardingPhase 3Phase 3 stores filename + sha256 only. Real bytes are hashed and discarded. Phase 10 may add object storage.Old-PSP webhook on alias portaliasesPhase 3Audit event written; outbound webhook delivery deferred to Phase 10.CREDIT_LEG cert suite — full implementationparticipant-onboardingPhase 3Phase 3 ships precondition check (active key registered). Phase 4 fills with real credit-leg simulation.

Append to the deferred-items table:
ItemModuleDeferred fromNotesOperator-driven reversal trigger UIreversalsPhase 4Recovery writes transaction.reversal_needed audit events. Operator console (Phase 10) picks them up and offers one-click reversal. Programmatic subscribers (Phase 6 fraud, Phase 7 disputes) plug into the same audit feed.
And append to the constraints section (create one if it doesn't exist; "Constraints" is the new heading right after "Deferred items"):
Constraints — locked architectural facts
These are not deferrals — they are deliberate architectural limits.
ConstraintPhase lockedReasonParticipant codes are 4–8 ASCII characters, uppercase + digitsPhase 4 (B4.1, B3.1 retroactively)ISO 20022 BIC8 compatibility. The pacs.008 parser derives participantCode from BICFI via slice; codes longer than 8 chars cannot round-trip through BIC. Validator in participants/schema.js enforces this.idempotencyKey is 8–128 chars per envelopePhase 2Long enough for hashes, short enough to fit in ISO 8583 DE 37.Money is BigInt minor units; never Number for amountsPhase 1Boundary checker enforces.One operator (BoG-designated) per deploymentPhase 1Customizable by env (OPERATOR_NAME, COUNTRY_CODE, CURRENCY_DEFAULT) — the codebase supports redeployment to other countries.

ItemModuleDeferred fromNotesReal cron / k8s scheduler for intraday cyclessettlement-cyclePhase 5In-process scheduler ships. Real scheduling is Phase 10.Real BoG RTGS file delivery channelsettlement-cyclePhase 5CSV files written to output/rtgs/. Pickup mechanism is Phase 10.Real participant ledger feeds for reconciliationreconciliationPhase 5Identity feed ships. Real adapters (webhook, polling, SFTP) are Phase 10.

ItemModuleDeferred fromNotes30-day soak monitoring on fraud-flag rollofffraud-flagsPhase 6Tracked here so we don't lose it. Phase 10 ops-dashboard wires monitoring.ML scorer drift detection on real trafficfraud/mlPhase 6Deterministic shipped model doesn't drift. Real model + drift monitoring is Phase 11+.Real OFAC API integration (real-time updates)sanctionsPhase 6OFAC fake provider ships. Real adapter slots into the same provider interface.Real UN sanctions list integrationsanctionsPhase 6Same pattern.Real BoG/FIC watchlist integrationsanctionsPhase 6Same pattern.Device fingerprinting (participant SDK)fraudPhase 6RuleContext.device is intentionally null for now. SDK + signal upload is Phase 10+.SAR/STR filing automation (FIC-Ghana)disputes (will land here in Phase 7)Phase 6Hand-off pattern only. Real FIC integration is Phase 10.

ItemModuleDeferred fromNotesReal adjudicator workforce managementdisputesPhase 7Manual decisions work via direct API. Adjudicator queues, skill routing, escalation policies are Phase 10.ML-driven dispute outcome predictiondisputesPhase 7Auto-resolver handles deterministic cases. Probabilistic outcome prediction is Phase 11+.Smart-contract conditional dispute releasedisputesPhase 7Frontier item, Phase 11+.Real participant evidence-request webhook deliverydisputesPhase 7Audit dispute.evidence_requested written. Webhook delivery is Phase 10.

ItemModuleDeferred fromNotesCross-border R2P (interlinking with foreign R2P systems)overlays-r2pPhase 8Phase 9 cross-border framework will allow this; the R2P module already supports the metadata pattern.Real-time R2P notification pushoverlays-r2pPhase 8Webhook + push delivery is Phase 10.Programmable / oracle-triggered conditional escrowoverlays-escrowPhase 8Frontier item, Phase 11+. Current escrow supports 4 deterministic release conditions.BNPL / installment financial productsoverlays-mandatesPhase 8Could be built as a mandate variant later. Phase 11+.GRA tax/VAT integrationvariousPhase 8Phase 10 deferred.