#!/usr/bin/env bash
# Phase 6 — fraud, sanctions, network-graph, peer-flag, fast-track end-to-end.
# Resets the DB, runs the full Phase 6 e2e test (which exercises every fraud
# surface through the in-process orchestrator), then boots the monolith and
# smoke-tests the HTTP routes for fraud-rules, sanctions, network-graph,
# fraud-flags, and fast-track-reversal. Prints PHASE 6 OK on success.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> 0. Reset, migrate, seed"
pnpm reset
pnpm migrate
pnpm seed > /tmp/p6-seed.json

echo "==> 1. Lint + boundaries + full test suite"
pnpm lint
pnpm check-boundaries
pnpm vitest run

echo "==> 2. Boot the monolith"
TX_TEST_MODE=true node server.js > /tmp/sika-server-p6.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if curl -sf http://localhost:3000/health > /dev/null; then break; fi
  sleep 0.2
done
curl -sf http://localhost:3000/health > /dev/null || {
  tail -30 /tmp/sika-server-p6.log
  exit 1
}

echo "==> 3. Login as the seeded admin"
C=$(mktemp)
curl -sf -c "$C" -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}' > /dev/null

echo "==> 4. Seed sanctions providers + fraud rule packs (in-process — no HTTP seed routes)"
node scripts/seed-phase-6.mjs

echo "==> 5. Sanctions screen — OSAMA TEST PERSON is a hit"
HIT=$(curl -sf -b "$C" -X POST http://localhost:3000/sanctions/screen \
  -H 'content-type: application/json' \
  -d '{"name":"OSAMA TEST PERSON"}')
echo "$HIT" | jq -e '.data.hit == true' > /dev/null
echo "    hit details: $(echo "$HIT" | jq -c '.data.matches[0]')"

echo "==> 6. Verify rule packs are listed"
curl -sf -b "$C" http://localhost:3000/fraud/packs | jq -e '.data.packs | length >= 1' > /dev/null

echo "==> 7. Raise a peer fraud flag against an account"
FLAG=$(curl -sf -b "$C" -X POST http://localhost:3000/fraud-flags \
  -H 'content-type: application/json' \
  -d '{"subjectType":"ACCOUNT","subjectKey":"P5BANK02:5299990001","flagType":"CONFIRMED_FRAUD","flaggedBy":"P5BANK01","evidence":{"source":"phase6-demo"},"severity":90}')
echo "$FLAG" | jq -e '.data.flag.id' > /dev/null

echo "==> 8. Fast-track-reversal HTTP surface (list endpoint)"
curl -sf -b "$C" "http://localhost:3000/fast-track-reversal/" | jq -e '.data' > /dev/null

echo "==> 9. Network-graph alerts surface"
curl -sf -b "$C" "http://localhost:3000/network-graph/alerts" | jq -e '.data' > /dev/null

rm -f "$C"
echo
echo "PHASE 6 OK"
