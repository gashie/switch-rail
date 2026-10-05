# Sika Rail

A national instant payment rail. Banks, wallets, fintechs and government
agencies plug into it and pay each other in real time, 24/7, in whichever
message format they already speak (ISO 8583, ISO 20022, REST/JSON, SWIFT MT,
bulk files).

The rail owns the directory of accounts and aliases, the settlement positions,
the fraud engine, disputes, overlay services and cross-border legs.

## Features

- **Multi-format ingest** — ISO 8583, ISO 20022 (pacs.008 etc.), REST/JSON,
  SWIFT MT103/MT202 and CSV/XLSX bulk files, all translated into one canonical
  payment envelope.
- **Directory and aliases** — phone, email, Ghana Card PIN, merchant ID and
  custom handles resolve to accounts; name enquiry and Confirmation of Payee
  run before money moves.
- **Transaction lifecycle** — authorization pipeline, routing, credit-leg
  coordination, recovery worker, reversals and receipts, all driven by an
  explicit state machine with an operator kill-switch.
- **Ledger and settlement** — double-entry ledger, net positions, settlement
  cycles, liquidity checks, fees, reconciliation and end-of-day cutover.
- **Fraud and sanctions** — rule engine, ML scoring hook, sanctions screening,
  network-graph (mule ring) detection, cross-participant fraud flags and
  fast-track reversal.
- **Disputes** — reason-code SLA windows, evidence, auto-resolution for
  clear-cut cases and manual adjudication for the rest.
- **Overlay services** — Request to Pay, QR (static and dynamic), recurring
  mandates, bulk payments, cash-out, refunds, escrow and split payments.
- **Cross-border** — FX quotes, foreign rail registry, travel rule and atomic
  cross-border legs.
- **Operations** — hash-chained audit log, regulator console, ops dashboard,
  public status page, USSD gateway and participant onboarding.
- **Web apps** — operator, participant and citizen React apps under `ui/`.

## Architecture

A modular monolith: one repo, one PostgreSQL database, many modules.

- Every module under `modules/<name>/` has the same shape — `model.js` (SQL),
  `service.js` (business logic), `controller.js`, `routes.js`, `schema.js`
  (Joi), `index.js` (public surface) and `tests/`.
- Each module can boot on its own (`node modules/<name>/server.js`) and is
  also mounted into the main `server.js`.
- Modules only talk to each other through `index.js`. `pnpm check-boundaries`
  enforces this.
- PostgreSQL does the queueing (`SKIP LOCKED`) and the hash-chained audit
  table is the event log. No Redis, no Kafka, no ORM.
- Money is always `BigInt` minor units, IDs are UUIDv7 and timestamps are
  UTC `TIMESTAMPTZ`.

## Stack

Node.js 20, plain JavaScript (ESM), Express 4, Joi, `pg` (raw SQL), pino,
argon2, vitest. React + Vite + Tailwind for the web apps.

## Getting started

```sh
pnpm install
cp .env.example .env
pnpm migrate
pnpm seed
pnpm start
```

Useful scripts:

| Command | What it does |
|---|---|
| `pnpm test` | Run the full test suite |
| `pnpm lint` | ESLint |
| `pnpm check-boundaries` | Enforce module import rules |
| `pnpm reset` | Drop and rebuild the local database |
| `pnpm ui:operator` / `ui:participant` / `ui:citizen` | Start a web app |
| `pnpm openapi:generate` | Regenerate `docs/openapi.json` |

End-to-end demo scripts live in `scripts/demo-*.sh`.
