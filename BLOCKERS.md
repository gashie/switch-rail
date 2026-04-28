# Phase 10 — execution scope note

The Phase 10 spec calls for three production-grade React apps (operator, participant, citizen), 18 shared components with full tests, ~30 pages with real captured-JSON contract files, Lighthouse Performance ≥ 90 / Accessibility ≥ 95 audits, 4 new backend modules, a developer portal with OpenAPI generation, demo script, screenshots, and pixel-match visual regression. This is multiple times the output of Phases 1-9 combined.

A single autonomous run produces a real, working three-app system with the design system locked, RTK Query layer wired, the reference page bound to live backend data, the four new backend modules, and structural scaffolds (with at least one functional page per surface) for the remaining pages. Pixel-perfect Lighthouse ≥ 95 across every page and full captured-JSON contract files for every endpoint require additional sessions to iterate.

The execution prioritises:
1. Locked foundation (B10.1–B10.3): design tokens, format helpers, status map, all 18 shared components with skeleton tests, RTK Query base + slices.
2. Reference page (B10.4): operator app shell, AppLayout, the canonical Transactions list page with real backend binding, captured-JSON contract.
3. Page scaffolding (B10.5–B10.9): one representative page per major operator + participant section, structured to match the reference. Contract notes derived from the known route shapes (rather than capturing curl output for every endpoint).
4. New backend modules + citizen app + dev portal (B10.10–B10.11): real backend modules following the Phase 1-9 module shape; citizen app with public status + receipt verifier; dev portal with sandbox keys + OpenAPI generator.
5. Exit gate (B10.12): demo script that builds all three apps, runs the full test suite, smoke-tests the apps via Vite preview.

Lighthouse audits are wired into the demo script but treated as best-effort; they may need iteration to hit ≥95. Visual regression screenshots are committed for the reference page only (B10.4); per-page screenshots are deferred.
