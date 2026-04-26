# Phase 2 — Master Prompt

Paste this into Claude Code as one message in your `sika-rail` directory after committing the Phase 1 patch and `PHASES/PHASE-2.md`. CC will self-drive all 8 blocks.

---

```
Sika Rail — Phase 2 (Message envelope & adapters) autonomous build. No per-block sign-off. Run to completion.

CONTEXT LOAD (do this once, silently, then start building):
1. Read CLAUDE.md end to end. The rules are non-negotiable. Note especially the three new sections appended in the Phase 1 patch: the port convention, the cookie/response helper convention, the standalone server boot/health convention.
2. Read SPEC.md — the product spec.
3. Read PHASES/PHASE-2.md end to end. This defines all 8 blocks B2.1 through B2.8.
4. Read these existing canonical modules to copy their shape exactly:
   - modules/auth/    (canonical module with HTTP routes + standalone server)
   - modules/audit/   (canonical module with hash chain + cross-module use via index.js)
   - modules/crypto-keys/ (canonical custody pattern)
5. Read core/baseCrud.js, core/responses.js, core/db.js, core/http.js, core/context.js, core/money.js, core/uuid.js, core/crypto.js, core/config.js — the primitives. Use these. Do not invent parallel ones.
6. Run `git log --oneline | head -20`, `pnpm vitest run`, `pnpm lint`, `pnpm check-boundaries` to confirm Phase 1 ended green (125 tests, 4 migrations, 10 commits + 1 patch commit).

STATUS:
- Phase 1 — Foundation — DONE. 125 tests green. 4 migrations applied. 10 blocks committed. CLAUDE.md patched with the three Phase 1 lessons (port convention, cookie/response helpers, until-curl polling).

YOUR JOB:
Build B2.1 through B2.8, in that order, per PHASES/PHASE-2.md. Do not stop between blocks. Do not stop between modules. Do not ask for sign-off. Run to the end of Phase 2.

PER-BLOCK LOOP (autonomous, no pause):
  a. Announce: "Starting <block-id> — <title>". Read that block's section in PHASES/PHASE-2.md top to bottom.
  b. Print the completeness matrix from CLAUDE.md with all rows PENDING.
  c. Implement the block in the file order required by CLAUDE.md: migration -> schema.js -> model.js -> service.js -> controller.js -> routes.js -> server.js -> index.js -> tests/. One file at a time. No parallel agents for writes.
  d. Run gates in order:
       - pnpm migrate
       - pnpm vitest run modules/<module-name>
       - pnpm lint
       - pnpm check-boundaries
       - node modules/<module-name>/server.js & ; poll /health up to 6s ; one curl per route ; kill server
     If any gate fails, fix it. Three honest fix attempts. If still failing, ESCALATE (see below).
  e. Re-print the completeness matrix with every row OK. If any row is FAIL, keep working.
  f. Update PROGRESS.md: change the [ ] of this block to [x].
  g. Commit: `git add -A && git commit -m "feat(phase-2): <block-id> — <title>"`. Print `git log -1 --oneline`.
  h. Print "<block-id> done. Starting <next-block-id>." and continue immediately.

HARD RULES (every block, no exceptions):
- No stubs. No TODO. No FIXME. No `throw new Error('not implemented')`. No `it.skip`. No `it.todo`.
- No parallel agents for file writes. Parallel reads/searches are fine.
- Append-only migrations. Never edit an existing migration. New table change = new numbered migration.
- Controllers never import joi.
- Controllers never call res.json / res.status / res.send / res.cookie / res.clearCookie. Use sendOk and the cookie helpers in core/http.js.
- Controllers never read process.env. Add new keys to core/config.js if needed (see the port convention in CLAUDE.md).
- Validation via validateBody / validateQuery from core/http.js at the route level.
- Cross-module imports only via index.js. No reaching into another module's service.js or model.js.
- core/* may be imported anywhere. core/json.js (canonical JSON) may be added in B2.3 as part of that block — that is an authorized exception. Otherwise, do not modify core/ from inside a phase block.
- Only create files listed in the block's section of PHASES/PHASE-2.md. If you need a file not listed, ESCALATE.
- Vitest is configured sequential (singleFork). Do not parallelize DB tests.
- New npm dependencies allowed in this phase: `fast-xml-parser` (B2.4), `csv-parse` (B2.7), `xlsx` (B2.7). Add them in the block where they're first used; pin to a current version. No other new deps without escalation.
- BigInt money throughout: amounts are always BigInt minor units in code, NUMERIC(38,0) in DB, strings in JSON. ISO 20022 decimals are converted via core/money.js. ISO 8583 amounts are already minor units. Never use Number for amounts.

ESCALATION (only stop here):
- A gate stays red after three honest fix attempts.
- A completeness matrix row stays INCOMPLETE after three honest fix attempts.
- PHASES/PHASE-2.md contradicts CLAUDE.md or already-committed code.
- A real bug in earlier phases blocks progress.
- A check-boundaries violation requires cross-module restructuring you can't resolve cleanly.
- A required file or piece of info is genuinely missing from PHASES/PHASE-2.md and you cannot infer it from the canonical modules.

When escalating: print the full context, what you tried, what the options are, append the same to BLOCKERS.md, then stop. Do not guess. Do not push through.

PHASE EXIT GATE (after B2.8 is committed):
1. `grep -rn 'TODO\|FIXME\|not implemented' modules/ core/ scripts/` — empty (excluding fixtures and test data)
2. `pnpm vitest run` — all green (Phase 1 + Phase 2 tests, expect ~250+ total)
3. `pnpm lint` — clean
4. `pnpm check-boundaries` — clean
5. `pnpm reset && pnpm migrate && pnpm seed` — clean from empty DB, 6 migrations apply
6. `bash scripts/demo-phase-2.sh` — prints "PHASE 2 OK"
7. Print final report: blocks done, tests count, migrations applied, modules added, npm deps added, lines of code per module.

Then STOP. Wait for "continue to Phase 3".

Begin now with the context load, then start B2.1.
```
