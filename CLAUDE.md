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


# CLAUDE.md — Phase 1 Patch

Append the following three sections to the bottom of your existing `CLAUDE.md`. They lock in the canonical patterns that emerged from Phase 1 deviations #3, #4, and #10. Phase 2 onward inherits these automatically.

Also: **move** `PHASE-1.md` from repo root into `PHASES/`. CLAUDE.md and the master prompt template both reference `PHASES/PHASE-N.md`. Quick fix:

```bash
git mv PHASE-1.md PHASES/PHASE-1.md
git commit -m "chore: move PHASE-1.md into PHASES/ to match CLAUDE.md path"
```

Then append the three sections below to `CLAUDE.md`.

---

## The port convention — every standalone server uses this

Every module that ships a standalone `server.js` must:

1. Read its port from `core/config.js` only. **Never** `process.env.<MODULE>_PORT` directly — that breaks `no-process-env-outside-config`.
2. Add a key to `config.js` named `<module>Port` (camelCase). Sourced from env `<MODULE>_PORT` with a numeric default in the 4xxx range.
3. Use the keys already allocated:

| Module | env var | default port | config key |
|---|---|---|---|
| auth | `AUTH_PORT` | 4001 | `authPort` |
| audit | `AUDIT_PORT` | 4002 | `auditPort` |
| crypto-keys | `CRYPTO_KEYS_PORT` | 4003 | `cryptoKeysPort` |
| envelope | `ENVELOPE_PORT` | 4101 | `envelopePort` |
| adapters-rest | `ADAPTERS_REST_PORT` | 4102 | `adaptersRestPort` |
| adapters-iso20022 | `ADAPTERS_ISO20022_PORT` | 4103 | `adaptersIso20022Port` |
| adapters-iso8583 | `ADAPTERS_ISO8583_PORT` | 4104 | `adaptersIso8583Port` |
| adapters-swift | `ADAPTERS_SWIFT_PORT` | 4105 | `adaptersSwiftPort` |
| adapters-bulk | `ADAPTERS_BULK_PORT` | 4106 | `adaptersBulkPort` |
| participants | `PARTICIPANTS_PORT` | 4201 | `participantsPort` |
| directory | `DIRECTORY_PORT` | 4202 | `directoryPort` |
| aliases | `ALIASES_PORT` | 4203 | `aliasesPort` |
| name-enquiry | `NAME_ENQUIRY_PORT` | 4204 | `nameEnquiryPort` |

Future phases pick the next free port in their range. Range allocation: 41xx envelope/adapters, 42xx directory, 43xx transactions/routing, 44xx ledger/settlement, 45xx fraud, 46xx disputes, 47xx overlays, 48xx cross-border, 49xx ops/citizen.

## The cookie/response helper convention

Controllers may not call `res.cookie`, `res.clearCookie`, `res.json`, `res.status`, or `res.send` directly. The `no-res-methods-in-controller` rule forbids it.

For cookies, use the helpers in `core/http.js` introduced in B1.7:

- `setSessionCookie(res, name, value, options)`
- `clearSessionCookie(res, name)`

For response bodies, use `sendOk(res, data, status)` already in `core/http.js`.

If a future block needs a new helper (e.g. `sendStream(res, stream)` for file downloads), add it to `core/http.js` rather than calling `res.*` from a controller.

## The standalone server boot/health convention

Every standalone `server.js` in a module must use the **poll-with-timeout** pattern in its demo scripts, not `sleep N`. Sleep is unreliable on cold boots.

The canonical wait-for-health snippet for any phase demo script:

```bash
node modules/<n>/server.js &
SERVER_PID=$!
for i in $(seq 1 30); do
  if curl -sf http://localhost:<port>/health > /dev/null; then break; fi
  sleep 0.2
done
curl -sf http://localhost:<port>/health   # actually verify response
# ... rest of test ...
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null || true
```

Phase demo scripts (`scripts/demo-phase-N.sh`) all follow this pattern.

he idempotent insert pattern — canonical from Phase 2
Whenever a module needs idempotent insert behavior on a unique key (envelopes, transactions, settlement positions, dispute cases, etc.), use the INSERT … ON CONFLICT DO NOTHING RETURNING pattern. Do NOT use SELECT FOR UPDATE then conditional INSERT — it's two round-trips and has race window edge cases.
Canonical shape:
js// inside service.js, called within withTransaction
const inserted = await client.query(
  `INSERT INTO things (id, idempotency_key, ...)
   VALUES ($1, $2, ...)
   ON CONFLICT (originator_participant, idempotency_key) DO NOTHING
   RETURNING *`,
  [id, key, ...]
);

if (inserted.rows.length === 1) {
  return { row: inserted.rows[0], deduped: false };
}

// conflict — fetch and content-check
const existing = await client.query(
  `SELECT * FROM things WHERE originator_participant = $1 AND idempotency_key = $2`,
  [participant, key]
);

if (!contentMatches(existing.rows[0], incoming)) {
  throw new AppError('IDEMPOTENCY_CONFLICT', 'duplicate key with different content', 409);
}

return { row: existing.rows[0], deduped: true };
Content-match scope is the immutable identity bits — for envelopes that's amount + originator + beneficiary. Reference, remittance, and metadata may legitimately vary on retry.
Cross-module utility sharing — explicit index.js re-export
If module A has a utility (e.g. an XML parser, a money formatter, a fee calculator) that module B legitimately needs, A's index.js re-exports it as part of A's public surface. B imports from '../A/index.js'. Never reaches into '../A/internal.js'.
This is the only way to share utilities across modules. The boundary checker enforces it.
The stripVolatile test helper
For round-trip tests where some fields are rail-assigned (e.g. envelopeId, createdAt, signature), use a shared helper to strip them before comparison:
js// tests/helpers/stripVolatile.js
export const stripVolatile = (env) => {
  const { envelopeId, createdAt, signature, ...rest } = env;
  return rest;
};
Located at tests/helpers/stripVolatile.js (top-level tests/, not inside any module).


Operator kill-switch in every state machine
Any state machine in any module must allow terminate (or equivalent terminal kill) from any non-terminal state. Operators and regulators need a kill-switch that doesn't require working through normal transitions. Phase 3's participant onboarding established this; every later phase follows it.
In Phase 4 (transactions): a transaction in any non-terminal state can be force-rejected by an authorized operator with reason code OPERATOR_KILL_SWITCH. In Phase 7 (disputes): same. In Phase 8 (mandates): same. In Phase 9 (cross-border): same.
Audit event format: <entity>.terminated with payload {reason, operatorId, fromState}.
Counter durability via separate connection
When a service tracks attempts on a security-sensitive operation (OTP attempts, dispute filing attempts, fraud verification attempts, etc.), the attempt counter increments must happen in a separate DB connection that commits independently — not inside the same transaction as the operation itself.
Reason: if the operation throws (wrong code, bad input, etc.), the surrounding transaction rolls back and the increment is lost. Attackers retry indefinitely.
Canonical shape (proven in Phase 3 OTP):
js// inside service.js
export const consumeWithAttempt = async ({ id, code }) => {
  // 1. Increment attempts in its OWN connection. Commit immediately.
  await withClient(async (c) => {
    await c.query(
      `UPDATE challenges SET attempts = attempts + 1 WHERE id = $1`,
      [id]
    );
  });

  // 2. Now check max attempts
  const challenge = await findById(id);
  if (challenge.attempts > challenge.maxAttempts) {
    throw new AppError('TOO_MANY_ATTEMPTS', '...', 429);
  }

  // 3. Proceed with the actual operation in a fresh transaction
  return withTransaction(async (c) => {
    if (challenge.code !== code) throw new AppError('INVALID_CODE', '...', 400);
    // ... mark consumed, etc.
  });
};
Apply this pattern in:

Phase 4 transaction recovery (retry attempt counter)
Phase 7 dispute filing (max attempts per case)
Phase 6 fraud verification challenges
Phase 9 cross-border travel rule challenges



Audit-event-then-operator-confirm for ambiguous money movement
When the rail is unsure whether a credit was applied (recovery exhaustion, status-check ambiguity, cross-border timeout, etc.), the rail does not auto-execute a reversal. Auto-reversing a credit that was actually applied debits the participant a second time.
The canonical pattern (proven in Phase 4 recovery):

Transition to terminal state (FAILED, or whatever applies).
Write an audit event of the form <entity>.reversal_needed with full context.
Stop.

An operator (human, or a Phase 6 fraud subscriber, or a Phase 7 dispute consumer) picks up the audit signal and decides whether to execute the reversal. The decision is logged as a separate audit event.
This rule applies in:

Phase 4: transaction.reversal_needed after RECON_FAILED (already implemented).
Phase 5: settlement.adjustment_needed after intraday recon break that can't be auto-resolved.
Phase 7: dispute.reversal_needed after adjudication ruling.
Phase 9: crossborder.reversal_needed after foreign-rail timeout.

Function signature as rule enforcement
When a rule must not be violated, the function signature itself should make violation impossible. Counter durability is the proof case: bumpAttemptsOnSeparateConnection(db, ...) takes the pool, not a transaction client. There is no way to accidentally call it inside a transaction.
Apply this thinking in Phase 5:

Ledger writes take a ledgerClient (a wrapper that enforces double-entry balance) rather than a raw pg client. A caller cannot accidentally write a single-sided entry.
Settlement-cycle close takes a cycleId and a closing-reason — it's impossible to "accidentally close" without explicit reason.
EOD cutover takes a cutoverConfirmation token issued by an authorized operator — it's impossible to roll the day forward without explicit authorization.

Atomic state-transition + side-effect issuance
When a state transition must produce a side effect (receipt, statement, settlement entry), both happen in the same DB transaction. Proven in Phase 4 (CONFIRMED transition + receipt issuance) and again in recovery (CONFIRMED from PENDING_RECONCILIATION + receipt issuance).
Phase 5 reuses the pattern: every successful credit leg posts to the ledger in the same transaction as the CONFIRMED state transition. EOD snapshot generation issues a hash-frozen statement in the same transaction as the day-rollover.
Retroactive integration into earlier phases
When a later phase needs to integrate into a module from an earlier phase (e.g. Phase 5 added ledger writes into Phase 4's orchestrator), the rule is:

The earlier phase's tests must keep passing. No regression. If tests need updating to reflect new behavior, the test changes are additive — the original assertions still hold; new assertions are added.
The earlier phase's public surface (index.js) must keep working. Other modules calling via the public surface must not need to change.
The integration is documented in the new phase's PHASE-N.md under a "Retroactive Phase N integration" section.
Audit: every retroactive call is wrapped in audit (<earlier-event>.with_<new-side-effect>) so operators can see the chain.

If a retroactive integration would require breaking an earlier phase's public surface, that's an ESCALATION, not a silent rewrite.
Phase 5 proved this works (Phase 4 orchestrator + recovery worker integrated cleanly with ledger). Phase 6 retroactively integrates fraud and sanctions at B4.2's stub points with the same discipline.
Performance budget for in-line authorization
Every check inside the authorization pipeline (Phase 4 B4.2 + Phase 6 fraud/sanctions/network-graph) has a hard latency budget. The whole pipeline must complete in under 100ms p95 for DOMESTIC_INSTANT transactions. Per-check budgets:
Checkp95 budgetduplicates5msaccount-status5mssanctions15msfraud (rules)25msfraud (ML scoring hook)25msnetwork-graph (cache hit)10mslimits10msliquidity5ms
Sum target: 100ms p95. Anything heavier must split into a fast path (in-line, deterministic) and a slow path (async, write-only). The slow path can flag for review or adjust reputation, but it does not block the wire.

Per-reason-code SLA windows
When a workflow has multiple reason codes that each carry their own deadline (Phase 7 disputes, future regulatory escalations, future cross-border challenge windows), the SLA window is a property of the reason code, not the workflow.
Canonical shape (proven in Phase 6 fast-track reversal at 80 days, generalized for Phase 7):
js// modules/<workflow>/sla-config.js
export const SLA_WINDOWS = Object.freeze({
  FRAUD: { fileWithinDays: 80, respondWithinDays: 5 },
  UNAUTHORIZED: { fileWithinDays: 60, respondWithinDays: 5 },
  DUPLICATE: { fileWithinDays: 90, respondWithinDays: 3 },
  GOODS_NOT_RECEIVED: { fileWithinDays: 120, respondWithinDays: 7 },
  // ... etc
});
Window enforcement happens at file-time and at adjudication-clock-tick time. The reason code is locked at filing — changing the reason mid-case would change the SLA, which is a regulatory hazard.
One workflow ≠ one process
A workflow may have an automated path and a manual path. Phase 6 fast-track is the proof: 95%+ of fraud cases follow the automated freeze→confirm path; ambiguous cases route to operator manual confirm. Phase 7 disputes follow the same: clear-cut auto-resolution (e.g. proven duplicate transaction with matching idempotency markers) skips human review; ambiguous cases route to adjudicators.
The split point is the dispute reason and the strength of the evidence. Auto-resolution is conservative — when in doubt, route to a human. Audit-event-then-operator-confirm rule still applies to the money-movement step.

Audit log as queryable source-of-truth
The audit log is not just a write-only history. It is a queryable source-of-truth for after-the-fact reasoning. When a later workflow needs to know "did event X happen for entity Y at time Z", querying audit_events by event_type + resource_type + resource_id + occurred_at range is the canonical answer.
Phase 7 proved this: the r-wrong-beneficiary auto-resolver reaches into audit_events to find cop.executed events for the original transaction, then inspects their payloads to determine if the customer overrode a no-match warning.
This pattern applies to:

Phase 9 cross-border: was sanctions screening done at the foreign-rail leg?
Future SAR/STR filing: timeline reconstruction from audit_events
Regulator console (Phase 10): all queries route through audit_events as the lookup index

Audit events are therefore part of the public contract of every module, not an implementation detail. Adding or renaming an event_type is a breaking change.
Overlay rule: every overlay is a thin layer on the core transaction lifecycle
Phase 8 builds 8 overlay services (R2P, QR, mandates, bulk, cash-out, refunds, escrow, split). Each one takes a customer-facing concept (a "request to pay", a "QR code", a "recurring mandate") and turns it into one or more standard transactions through the existing Phase 4 transaction lifecycle.
The rule: overlays do not reinvent payment primitives. They reuse:

transactions/orchestrator.processTransaction(envelope) for any money movement
The standard envelope shape (msgType extensions are the only addition)
The standard fraud, sanctions, liquidity, and ledger flows
The standard dispute reason codes (with overlay-specific reasons added to the locked taxonomy)

If an overlay seems to need to bypass the orchestrator, that's an ESCALATION — the overlay should be implemented as a chain of standard transactions, not as a parallel money-movement path.

Overlay rule refinement: rail-internal account legs
The overlay rule from Phase 7 ("overlays go through the orchestrator") has one defined exception: when one side of the money movement is a rail-internal account (RAIL_ESCROW, RAIL_DISPUTE_RESERVE, RAIL_FEE_REVENUE, RAIL_SUSPENSE, RAIL_REVERSAL, OPERATOR_RTGS_NOSTRO), the operation may post directly via ledgerService.postJournal instead of going through transactions/orchestrator.processTransaction.
Why: the orchestrator's purpose is participant-to-participant credit-leg coordination — it calls the beneficiary's credit_leg HTTP endpoint and waits for confirmation. There's no participant on the other side of RAIL_ESCROW, so there's no endpoint to call. The orchestrator would have nothing to do.
The line is sharp:

Participant ↔ Participant → orchestrator (always)
Participant ↔ Rail-internal account → direct ledger post (always)
Rail-internal ↔ Rail-internal → direct ledger post (always)

Established by Phase 7 dispute-reserve, ratified by Phase 8 escrow.
This refinement applies in Phase 9 as well: cross-border legs that touch the rail's nostro/vostro accounts at the central bank go through direct ledger posts, while the participant ↔ rail leg goes through the orchestrator.