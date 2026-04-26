# Autonomous Phase Master Prompts

This file is for the human, not for CC. After Phase 1 is done, the human picks the right prompt template below, fills in the phase number, pastes it once into Claude Code, and walks away.

CC reads CLAUDE.md, SPEC.md, the active `PHASE-N.md`, and the existing canonical modules. CC self-drives every block in the phase. Only stops if it hits a real blocker, in which case it writes `BLOCKERS.md` and waits.

---

## Generic master prompt (use for Phase 2 through 10)

Copy this into Claude Code as one message. Replace `<N>` with the phase number, `<NAME>` with the phase name, `<FIRST_BLOCK>` with the first block id (e.g. `B2.1`), `<LAST_BLOCK>` with the last block id (e.g. `B2.8`), and update the STATUS section with the latest test count.

```
Sika Rail — Phase <N> (<NAME>) autonomous build. No per-block sign-off. Run to completion.

CONTEXT LOAD (do this once, silently, then start building):
1. Read CLAUDE.md end to end. The rules are non-negotiable.
2. Read SPEC.md — the product spec.
3. Read PHASES/PHASE-<N>.md end to end. This defines every block in this phase from <FIRST_BLOCK> to <LAST_BLOCK>.
4. Read these existing canonical modules to copy their shape exactly:
   - modules/auth/  (canonical module with HTTP routes + standalone server)
   - modules/audit/ (canonical module with hash chain + cross-module use via index.js)
   - modules/crypto-keys/ (canonical library + custody pattern)
5. Read core/baseCrud.js, core/responses.js, core/db.js, core/http.js, core/context.js — the primitives. Use these. Do not invent parallel ones.
6. Run `git log --oneline | head -20`, `pnpm vitest run`, `pnpm lint`, `pnpm check-boundaries` to confirm the previous phase ended green.

STATUS:
- Phase 1 — Foundation — DONE. <N1> tests green.
- Phases 2..<N-1> (if any) — DONE per PROGRESS.md.

YOUR JOB:
Build <FIRST_BLOCK> through <LAST_BLOCK>, in that order, per PHASES/PHASE-<N>.md. Do not stop between blocks. Do not stop between modules. Do not ask for sign-off. Run to the end of Phase <N>.

PER-BLOCK LOOP (autonomous, no pause):
  a. Announce: "Starting <block-id> — <title>". Read that block's section in PHASES/PHASE-<N>.md top to bottom.
  b. Print the completeness matrix from CLAUDE.md with all rows PENDING.
  c. Implement the block in the file order required by CLAUDE.md: migration -> schema.js -> model.js -> service.js -> controller.js -> routes.js -> server.js -> index.js -> tests/. One file at a time. No parallel agents for writes.
  d. Run gates in order:
       - pnpm migrate
       - pnpm vitest run modules/<module-name>
       - pnpm lint
       - pnpm check-boundaries
       - node modules/<module-name>/server.js & ; sleep 2 ; curl -sf http://localhost:<port>/health ; kill %1
       - one curl per route, real output pasted
     If any gate fails, fix it. Three honest fix attempts. If still failing, ESCALATE (see below).
  e. Re-print the completeness matrix with every row OK. If any row is FAIL, keep working.
  f. Update PROGRESS.md: change the [ ] of this block to [x].
  g. Commit: `git add -A && git commit -m "feat(phase-<N>): <block-id> — <title>"`. Print `git log -1 --oneline`.
  h. Print "<block-id> done. Starting <next-block-id>." and continue immediately.

HARD RULES (every block, no exceptions, all from CLAUDE.md):
- No stubs. No TODO. No FIXME. No `throw new Error('not implemented')`. No `it.skip`. No `it.todo`.
- No parallel agents for file writes. Parallel reads/searches are fine.
- Append-only migrations. Never edit an existing migration. New table change = new numbered migration.
- Controllers never import joi.
- Controllers never call res.json / res.status / res.send / res.cookie / res.clearCookie.
- Controllers never read process.env.
- Validation via validateBody / validateQuery from core/http.js at the route level.
- Cross-module imports only via index.js. No reaching into another module's service.js or model.js.
- core/* may be imported anywhere. Modules may not write to core/ from inside a phase block. If core needs a change, ESCALATE.
- Only create files listed in the block's section of PHASES/PHASE-<N>.md. If you need a file not listed, ESCALATE.
- Every test that touches the DB must use vitest's sequential mode (already configured in vitest.config.js) — do not parallelize.
- No microservices, no Redis, no Kafka. PostgreSQL is the queue (SKIP LOCKED). Hash-chained audit is the event log.

ESCALATION (only stop here):
- A gate stays red after three honest fix attempts.
- A completeness matrix row stays INCOMPLETE after three honest fix attempts.
- PHASES/PHASE-<N>.md contradicts CLAUDE.md or already-committed code.
- A real bug in earlier phases blocks progress.
- A check-boundaries violation requires cross-module restructuring you can't resolve cleanly.
- A required file or piece of info is genuinely missing from PHASES/PHASE-<N>.md and you cannot infer it from the canonical modules.

When escalating: print the full context, what you tried, what the options are, append the same to BLOCKERS.md, then stop. Do not guess. Do not push through.

PHASE EXIT GATE (after <LAST_BLOCK> is committed):
1. `grep -rn 'TODO\|FIXME\|not implemented' src/ modules/ core/` — empty
2. `pnpm vitest run` — all green
3. `pnpm lint` — clean
4. `pnpm check-boundaries` — clean
5. `pnpm reset && pnpm migrate && pnpm seed` — clean from empty DB
6. Run the demo script for this phase if PHASES/PHASE-<N>.md defines one — must print "PHASE <N> OK"
7. Print final report: blocks done, tests count, migrations applied, modules added.

Then STOP. Wait for "continue to Phase <N+1>".

Begin now with the context load, then start <FIRST_BLOCK>.
```

---

## Per-phase fill-in cheat sheet

Use these values when filling in the template above:

| Phase | NAME | FIRST_BLOCK | LAST_BLOCK |
|---|---|---|---|
| 2 | Message envelope & adapters | B2.1 | B2.8 |
| 3 | Participant registry & directory | B3.1 | B3.8 |
| 4 | Core transaction lifecycle | B4.1 | B4.12 |
| 5 | Settlement, liquidity & EOD | B5.1 | B5.8 |
| 6 | Fraud & risk in line | B6.1 | B6.8 |
| 7 | Disputes | B7.1 | B7.6 |
| 8 | Overlay services | B8.1 | B8.8 |
| 9 | Cross-border native | B9.1 | B9.6 |
| 10 | Operations, observability, citizen access | B10.1 | B10.6 |

---

## Operator workflow per phase

1. Get back to your repo. Confirm the previous phase ended clean (`pnpm vitest run`, `pnpm check-boundaries`, both green).
2. Ask Claude (this chat) to write the next phase's `PHASES/PHASE-<N>.md`. Provide the previous phase's final report so the new doc can build on it.
3. Commit the new `PHASE-<N>.md` to the repo.
4. Open Claude Code, paste the master prompt above with the right values filled in.
5. Walk away. Check back in a few hours / next day.
6. When CC stops with "PHASE <N> OK", run the demo script yourself, eyeball the BUILD_LOG-style output it produced, then say "continue to Phase <N+1>".
7. If CC stops with a blocker in `BLOCKERS.md`, read it, decide, paste the resolution as a new message, and CC continues from there.

---

## What you do RIGHT NOW

You have the four foundation docs in `/mnt/user-data/outputs/sika-rail/`. To start:

```bash
mkdir -p ~/dev/sika-rail
cd ~/dev/sika-rail
git init
# copy the four files in:
cp ~/Downloads/sika-rail/CLAUDE.md .
cp ~/Downloads/sika-rail/SPEC.md .
cp ~/Downloads/sika-rail/PROGRESS.md .
mkdir -p PHASES
cp ~/Downloads/sika-rail/PHASES/PHASE-1.md PHASES/
git add -A
git commit -m "docs: phase 1 foundation spec"
```

Then open Claude Code in that directory and paste:

```
Sika Rail — Phase 1 Foundation. Block-by-block sign-off.

CONTEXT LOAD:
1. Read CLAUDE.md end to end.
2. Read SPEC.md.
3. Read PROGRESS.md.
4. Read PHASES/PHASE-1.md end to end.

Then start B1.1 only. After B1.1 is done, stop and wait for me to say "continue to B1.2". Do not run multiple blocks in one go for Phase 1.

Begin now with the context load, then announce B1.1.
```

After all 10 Phase 1 blocks are signed off, switch to autonomous mode for Phase 2 onward using the master prompt template above.
