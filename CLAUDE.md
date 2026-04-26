# Sika Rail — Rules for Claude Code

Read this first. Every session. No exceptions.

## What we're building

Sika is a national payment rail. Banks, wallets, fintechs, and government plug into it and pay each other through it instantly, 24/7, in any format (ISO 8583, ISO 20022, REST/JSON, SWIFT MT). It owns the directory of every account and alias in the country, the settlement positions, the fraud engine, the disputes, and the cross-border legs.

The full feature list is in `SPEC.md`. The build is split into 10 phases of ~80 blocks total. The current phase is in `PROGRESS.md`. Block-level detail for the active phase is in `PHASES/PHASE-N.md`.

## The rules — non-negotiable

1. **One block at a time.** Do the lowest-numbered unticked block in `PROGRESS.md`. Don't jump ahead. Don't merge blocks.

2. **No stubs. Ever.** No empty files. No `// TODO`. No `// FIXME`. No `throw new Error('not implemented')`. No `it.skip()`. No `it.todo()`. If you can't finish the block, stop and escalate.

3. **No parallel agents for writes.** Sequential file creation only. Parallel reads/searches are fine.

4. **Append-only migrations.** Never edit an existing migration file. To change a table, write a new numbered migration. `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. No `DROP`, no `TRUNCATE`, no `-- DOWN`.

5. **Existing code is the secondary spec.** From Phase 2 onward, before writing a new module, read the canonical modules: `modules/auth/`, `modules/audit/`, `modules/participants/`. Copy their shape exactly. Don't invent.

6. **Tick `PROGRESS.md` yourself.** When a block ends, change `[ ]` to `[x]`. Commit it with the block's code.

7. **Real output as proof.** Every block ends with a completeness matrix and pasted output of every gate (tests, lint, boundaries, curl). Not "tests pass" — actual output.

8. **Stop at phase boundaries.** When the last block of a phase is committed, run the phase exit gate. Then stop. Wait for "continue."

9. **Stop and escalate, don't guess.** If you'd have to break a rule to proceed, or the spec is missing info, or a gate stays red after three honest fix attempts — stop. Write to `BLOCKERS.md` what you found, what you tried, what the options are. Don't push through.

## The stack — locked, not up for debate

- **Node.js 20**, ESM (`"type": "module"` in every `package.json`)
- **Plain JavaScript only.** No TypeScript. No `.ts`, no `.d.ts`, no `tsconfig.json`. JSDoc for editor hints if helpful.
- **Express 4** for HTTP. Not Fastify. Not Koa.
- **Joi** for request validation
- **cookie-parser** for cookies
- **express-fileupload** for file uploads
- **pg** for PostgreSQL. Raw SQL only. No ORM. No query builder.
- **pino** for logging
- **vitest** for tests (`pnpm vitest run modules/<name>` per module)
- **argon2** for password hashing
- **BigInt** for all money. Never `Number` for amounts.
- **UUIDv7** for all IDs. App-generated. Stored as `UUID`.
- **TIMESTAMPTZ** for all timestamps. UTC only.

## The style

- **Functional only.** No `class`. No `new` (except for unavoidable third-party constructors). No `this`.
- **Factory functions.** `export const createService = ({ db }) => ({ ... })`.
- **Composition over inheritance.** There is no inheritance.
- **Pure functions where possible.** Side effects at the edges (DB, network, file).
- **Immutability by default.** Don't mutate parameters. Spread to copy.
- **One file, one concern.** Don't pile.

## The import rules

1. **Cross-module imports go through `index.js` only.**
   - YES: `import { listAliases } from '../directory/index.js'`
   - NO:  `import { listAliases } from '../directory/service.js'`
2. **Modules never import each other's `model.js`, `service.js`, or `controller.js` directly.**
3. **`core/` may be imported anywhere.** Modules may not write to `core/`.
4. **Tests live next to code.** `modules/<name>/tests/<name>.test.js`. They import from the local module only.

## The module shape — every module looks the same

```
modules/<name>/
├── model.js          # raw SQL queries via pg. The ONLY file that talks to DB.
├── service.js        # business logic. Imports model. Pure where possible.
├── controller.js     # thin. Calls service. Returns response envelopes.
├── routes.js         # Express router. validateBody/validateQuery -> controller.
├── schema.js         # Joi schemas for request/response shapes.
├── server.js         # standalone mode: `node modules/<name>/server.js` boots the module on its own port with /health.
├── index.js          # named exports for cross-module use. Nothing else exported.
└── tests/
    └── <name>.test.js
```

Controllers never:
- import Joi
- read `process.env`
- call `res.status`, `res.json`, `res.send`, `res.cookie`, `res.clearCookie` directly
- contain SQL

Services never:
- contain SQL (delegate to model)
- read `process.env`
- import another module's internals (must go via `index.js`)

Models never:
- contain business logic
- import services or controllers

## The per-block loop

Every block, no exceptions:

1. **Announce.** Print `Starting B<N>.<X> — <title>`. Read that block's section in `PHASES/PHASE-<N>.md` end to end.
2. **Read the canonical modules.** From Phase 2 onward, open `modules/auth/` and one similar existing module. Note their shape.
3. **State the completeness matrix.** Print the matrix with all rows marked `PENDING`. (See "Completeness matrix" below.)
4. **Implement in file order.** Migration → schema.js → model.js → service.js → controller.js → routes.js → server.js → index.js → tests/. One file at a time.
5. **Run the gates.** In order:
   - `pnpm migrate` — clean apply, no errors
   - `pnpm vitest run modules/<name>` — all green
   - `pnpm lint` — clean
   - `pnpm check-boundaries` — clean
   - `node modules/<name>/server.js` in background, `curl http://localhost:<port>/health` returns 200, then kill
   - One `curl` per route, real output pasted
6. **Re-mark the matrix.** Every row `OK`. If any row is `FAIL`, fix it before continuing.
7. **Tick PROGRESS.md.** Change `[ ]` to `[x]` for this block.
8. **Commit.** `git add -A && git commit -m "feat(phase-<N>): block B<N>.<X> — <title>"`. Print `git log -1 --oneline`.
9. **Print "B<N>.<X> done. Starting B<N>.<X+1>." and continue immediately.**

## Completeness matrix

Print this table at the start (PENDING) and end (OK/FAIL) of every block:

| # | Check | Status |
|---|---|---|
| 1 | Migration applied | PENDING |
| 2 | Files in correct order created | PENDING |
| 3 | Schema (Joi) defined | PENDING |
| 4 | Model has all needed queries | PENDING |
| 5 | Service has all business logic | PENDING |
| 6 | Controller is thin (no SQL, no Joi, no res.\*) | PENDING |
| 7 | Routes use validateBody / validateQuery | PENDING |
| 8 | Standalone server.js boots, /health = 200 | PENDING |
| 9 | Tests cover happy + sad paths, all pass | PENDING |
| 10 | Lint clean | PENDING |
| 11 | check-boundaries clean | PENDING |
| 12 | Curl output pasted for every route | PENDING |
| 13 | PROGRESS.md ticked | PENDING |
| 14 | Committed | PENDING |

## When to stop and escalate (only)

- A gate stays red after **three honest fix attempts**.
- The active `PHASE-N.md` contradicts `CLAUDE.md` or already-committed code.
- A required file or piece of info isn't in `PHASE-N.md` and you can't reasonably infer it from existing modules.
- A real bug in earlier phases blocks progress.
- A `check-boundaries` violation requires cross-module restructuring you can't resolve cleanly.

In any of those cases: write `BLOCKERS.md` with full context, what you tried, what the options are, then stop.

## What "done" means

For a block: matrix all `OK`, tests/lint/boundaries green, curl pasted, PROGRESS.md ticked, committed.

For a phase: every block in that phase ticked, the phase exit gate at the bottom of `PHASES/PHASE-<N>.md` runs clean (grep for TODO/FIXME/not implemented = empty, full test suite green, migrations clean from empty DB).

For the rail: all 10 phases done, demo scripts run end-to-end, boundary checker clean across the whole tree.
