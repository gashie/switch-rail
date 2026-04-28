#!/usr/bin/env bash
# Phase 9 — cross-border native end-to-end. Resets, migrates, seeds, runs the
# full Phase 9 e2e test (which exercises the entire cross-border stack:
# foreign rails, FX, PvP coordinator, travel rule, settlement assets), then
# boots the monolith and smoke-tests each cross-border surface.
# Prints PHASE 9 OK on success.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> 0. Reset, migrate, seed"
pnpm reset
pnpm migrate
pnpm seed > /tmp/p9-seed.json

echo "==> 1. Lint + boundaries + full test suite"
pnpm lint
pnpm check-boundaries
pnpm vitest run

echo "==> 2. Boot the monolith"
TX_TEST_MODE=true node server.js > /tmp/sika-server-p9.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if curl -sf http://localhost:3000/health > /dev/null; then break; fi
  sleep 0.2
done
curl -sf http://localhost:3000/health > /dev/null || {
  tail -30 /tmp/sika-server-p9.log
  exit 1
}

echo "==> 3. Login as the seeded admin"
C=$(mktemp)
curl -sf -c "$C" -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}' > /dev/null

echo "==> 4. Cross-border surfaces — list endpoints"
curl -sf -b "$C" "http://localhost:3000/crossborder-rails/?limit=10" | jq -e '.data' > /dev/null
curl -sf -b "$C" "http://localhost:3000/crossborder-travel-rule/?limit=10" | jq -e '.data' > /dev/null
curl -sf -b "$C" "http://localhost:3000/settlement-assets/adapters" | jq -e '.data.items | contains(["LOCAL_CURRENCY_NET","CBDC","STABLECOIN"])' > /dev/null
echo "    crossborder-rails, travel-rule, settlement-assets all reachable"

echo "==> 5. Foreign-rail simulator quote round-trip"
QUOTE=$(curl -sf -X POST http://localhost:3000/simulator-foreign/PAPSS_FAKE/quote \
  -H 'content-type: application/json' \
  -d '{"payCurrency":"GHS","receiveCurrency":"NGN","payAmount":"100000"}')
echo "$QUOTE" | jq -e '.data.lockedRate == "15.42"' > /dev/null
echo "    simulator quote OK at locked rate 15.42"

echo "==> 6. Settlement-asset settle (CBDC fake)"
curl -sf -b "$C" -X POST http://localhost:3000/settlement-assets/settle \
  -H 'content-type: application/json' \
  -d '{"assetType":"CBDC","payAmountMinor":"100000","payCurrency":"GHS","receiveAmountMinor":"154200","receiveCurrency":"NGN","foreignRailCode":"PAPSS_FAKE"}' \
  | jq -e '.data.ok == true and (.data.settlementRef | startswith("CBDC-"))' > /dev/null
echo "    CBDC settlement OK"

rm -f "$C"
echo
echo "PHASE 9 OK"
