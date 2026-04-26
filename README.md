# Sika Rail

A national payment rail. Banks, wallets, fintechs, and government plug into it
and pay each other through it instantly, 24/7, in any format.

## Read these first

- [`CLAUDE.md`](./CLAUDE.md) — the rules. Every contributor (human or agent)
  reads this every session.
- [`SPEC.md`](./SPEC.md) — what the rail is, what it does, the architecture.
- [`PROGRESS.md`](./PROGRESS.md) — the source of truth for what is done and
  what is next.
- [`PHASES/PHASE-1.md`](./PHASES/PHASE-1.md) — block-by-block detail for Phase 1.

## Stack

Node.js 20+, plain JavaScript (ESM), Express 4, Joi, raw `pg` against
PostgreSQL, vitest, argon2. No TypeScript, no ORM, no Redis, no Kafka.

## Getting started (after Phase 1 lands)

```sh
pnpm install
cp .env.example .env
pnpm migrate
pnpm seed
pnpm start
```
