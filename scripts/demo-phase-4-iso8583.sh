#!/usr/bin/env bash
# Phase 4 — ISO 8583 (0200) end-to-end demo
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TX_TEST_MODE=true node server.js > /tmp/sika-server-iso8583.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if curl -sf http://localhost:3000/health > /dev/null; then break; fi
  sleep 0.2
done
curl -sf http://localhost:3000/health > /dev/null || {
  tail -30 /tmp/sika-server-iso8583.log
  exit 1
}

COOKIE_JAR="$(mktemp)"

echo "==> 1. Login"
curl -sf -c "$COOKIE_JAR" -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}' > /dev/null

NOW="$(date +%s)"
node scripts/build-fixture.mjs iso8583 scripts/fixtures/p4-happy.json "/tmp/p4-iso8583-happy-${NOW}.bin" "h${NOW}"
node scripts/build-fixture.mjs iso8583 scripts/fixtures/p4-insufficient.json "/tmp/p4-iso8583-insuf-${NOW}.bin" "i${NOW}"

echo "==> 2. Happy 0200 → CONFIRMED"
RESP=$(curl -sf -b "$COOKIE_JAR" -X POST 'http://localhost:3000/adapters-iso8583/process?version=1987' \
  -H 'content-type: application/octet-stream' \
  --data-binary "@/tmp/p4-iso8583-happy-${NOW}.bin")
echo "$RESP" | jq '.data | { state, transactionId, responseCode, deduped }'
[ "$(echo "$RESP" | jq -r '.data.state')" = "CONFIRMED" ]

echo "==> 3. Insufficient 0200 → REJECTED with INSUFFICIENT_FUNDS"
RESP=$(curl -sf -b "$COOKIE_JAR" -X POST 'http://localhost:3000/adapters-iso8583/process?version=1987' \
  -H 'content-type: application/octet-stream' \
  --data-binary "@/tmp/p4-iso8583-insuf-${NOW}.bin")
echo "$RESP" | jq '.data | { state, reasonCode }'
[ "$(echo "$RESP" | jq -r '.data.state')" = "REJECTED" ]
[ "$(echo "$RESP" | jq -r '.data.reasonCode')" = "INSUFFICIENT_FUNDS" ]

rm -f "$COOKIE_JAR"
echo
echo "PHASE 4 ISO 8583 DEMO OK"
