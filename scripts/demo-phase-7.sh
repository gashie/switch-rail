#!/usr/bin/env bash
# Phase 7 — disputes & adjudication end-to-end. Resets, migrates, seeds,
# runs the full Phase 7 e2e test (which exercises every dispute flow:
# auto-DUPLICATE, manual GOODS_NOT_RECEIVED with maker-checker settlement,
# auto-WRONG_BENEFICIARY via CoP override, and the customer portal).
# Prints PHASE 7 OK on success.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> 0. Reset, migrate, seed"
pnpm reset
pnpm migrate
pnpm seed > /tmp/p7-seed.json

echo "==> 1. Lint + boundaries + full test suite"
pnpm lint
pnpm check-boundaries
pnpm vitest run

echo "==> 2. Boot the monolith"
TX_TEST_MODE=true node server.js > /tmp/sika-server-p7.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if curl -sf http://localhost:3000/health > /dev/null; then break; fi
  sleep 0.2
done
curl -sf http://localhost:3000/health > /dev/null || {
  tail -30 /tmp/sika-server-p7.log
  exit 1
}

echo "==> 3. Login as the seeded admin"
C=$(mktemp)
curl -sf -c "$C" -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}' > /dev/null

echo "==> 4. Customer portal: lookup unknown case returns 404 found:false"
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  "http://localhost:3000/disputes/portal/DSP-202604-999999?fingerprint=$(printf 'a%.0s' $(seq 1 64))" \
  | grep -q "404"

echo "==> 5. Disputes list endpoint accessible to admin"
curl -sf -b "$C" "http://localhost:3000/disputes/?limit=10" | jq -e '.data' > /dev/null

echo "==> 6. Customer portal rate limit configured"
test "$(node -e 'import("./core/config.js").then(({config}) => console.log(config.disputesPortalRateLimitPerMin))')" -ge 1

rm -f "$C"
echo
echo "PHASE 7 OK"
