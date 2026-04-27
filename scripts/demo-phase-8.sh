#!/usr/bin/env bash
# Phase 8 — overlay services end-to-end. Resets, migrates, seeds, runs the
# full Phase 8 e2e test (which exercises all 8 overlays through the
# orchestrator), then boots the monolith and smoke-tests each overlay's
# health endpoint via the unified server. Prints PHASE 8 OK on success.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> 0. Reset, migrate, seed"
pnpm reset
pnpm migrate
pnpm seed > /tmp/p8-seed.json

echo "==> 1. Lint + boundaries + full test suite"
pnpm lint
pnpm check-boundaries
pnpm vitest run

echo "==> 2. Boot the monolith"
TX_TEST_MODE=true node server.js > /tmp/sika-server-p8.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if curl -sf http://localhost:3000/health > /dev/null; then break; fi
  sleep 0.2
done
curl -sf http://localhost:3000/health > /dev/null || {
  tail -30 /tmp/sika-server-p8.log
  exit 1
}

echo "==> 3. Login as the seeded admin"
C=$(mktemp)
curl -sf -c "$C" -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}' > /dev/null

echo "==> 4. Smoke-test each overlay's HTTP surface (auth-gated → 200 list)"
for path in r2p mandates bulk/runs cashout refunds-overlay escrow splits; do
  curl -sf -b "$C" "http://localhost:3000/${path}/?limit=10" > /dev/null
  echo "    GET /${path}/ ok"
done

echo "==> 5. QR static encode → decode round-trip via API"
QR=$(curl -sf -b "$C" -X POST http://localhost:3000/qr/static \
  -H 'content-type: application/json' \
  -d '{"merchantParticipant":"P5BANK01","merchantAccountNumber":"5100000001","mcc":"5411","merchantName":"DEMO STORE"}')
ENCODED=$(echo "$QR" | jq -r '.data.qr.encoded_payload')
test -n "$ENCODED"
curl -sf -b "$C" -X POST http://localhost:3000/qr/decode \
  -H 'content-type: application/json' \
  -d "{\"encodedPayload\":\"$ENCODED\"}" | jq -e '.data.qrType == "STATIC" and .data.crcOk == true' > /dev/null

rm -f "$C"
echo
echo "PHASE 8 OK"
