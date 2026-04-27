#!/usr/bin/env bash
# Phase 4 — REST end-to-end demo
#
# Walks the rail through a full payment lifecycle in REST/JSON format:
#   1. Happy path → CONFIRMED with two signed receipts
#   2. AM04 force-account → REJECTED with INSUFFICIENT_FUNDS
#   3. Timeout force-account → PENDING_RECONCILIATION → recovery → terminal
#   4. Manual reversal of the happy-path tx → REVERSED
#   5. Idempotent re-post → same transactionId returned
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Use a deterministic clean state for the demo run.
pnpm reset
pnpm migrate
pnpm seed > /tmp/seed.json

# Boot the monolith in the background.
TX_TEST_MODE=true node server.js > /tmp/sika-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT

# Wait for /health.
for _ in $(seq 1 50); do
  if curl -sf http://localhost:3000/health > /dev/null; then break; fi
  sleep 0.2
done
curl -sf http://localhost:3000/health > /dev/null || {
  echo "server did not come up; tail of log:"
  tail -30 /tmp/sika-server.log
  exit 1
}

COOKIE_JAR="$(mktemp)"

echo "==> 1. Login as admin"
curl -sf -c "$COOKIE_JAR" -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}' > /dev/null

echo "==> 2. Happy path — REST inbound → CONFIRMED"
RESP=$(curl -sf -b "$COOKIE_JAR" -X POST http://localhost:3000/adapters-rest/process \
  -H 'content-type: application/json' \
  -d @scripts/fixtures/p4-happy.json)
echo "$RESP" | jq '.data | { state, transactionId, responseCode, deduped }'
TXID=$(echo "$RESP" | jq -r '.data.transactionId')
STATE=$(echo "$RESP" | jq -r '.data.state')
[ "$STATE" = "CONFIRMED" ] || { echo "expected CONFIRMED, got $STATE"; exit 1; }

echo "==> 3. Receipts: two signed entries"
curl -sf -b "$COOKIE_JAR" "http://localhost:3000/transaction-receipts/by-transaction/$TXID" \
  | jq '.data.receipts | length' \
  | grep -q '^2$' || { echo "expected 2 receipts"; exit 1; }

echo "==> 4. Insufficient funds (force account 9999000002) → REJECTED with INSUFFICIENT_FUNDS"
RESP=$(curl -sf -b "$COOKIE_JAR" -X POST http://localhost:3000/adapters-rest/process \
  -H 'content-type: application/json' \
  -d @scripts/fixtures/p4-insufficient.json)
echo "$RESP" | jq '.data | { state, reasonCode }'
[ "$(echo "$RESP" | jq -r '.data.state')" = "REJECTED" ]
[ "$(echo "$RESP" | jq -r '.data.reasonCode')" = "INSUFFICIENT_FUNDS" ]

echo "==> 5. Timeout (force account 9999000007) → PENDING_RECONCILIATION → recovery"
RESP=$(curl -sf -b "$COOKIE_JAR" -X POST http://localhost:3000/adapters-rest/process \
  -H 'content-type: application/json' \
  -d @scripts/fixtures/p4-timeout.json)
echo "$RESP" | jq '.data | { state, reasonCode }'
TXID2=$(echo "$RESP" | jq -r '.data.transactionId')
# Recovery worker polls every ~25ms in TX_TEST_MODE; allow generous slack.
for _ in $(seq 1 60); do
  STATE=$(curl -sf -b "$COOKIE_JAR" "http://localhost:3000/transactions/$TXID2" | jq -r '.data.transaction.state')
  if [ "$STATE" = "FAILED" ] || [ "$STATE" = "REJECTED" ] || [ "$STATE" = "CONFIRMED" ]; then break; fi
  sleep 0.5
done
echo "  recovery resolved to: $STATE"
[ "$STATE" = "FAILED" ] || [ "$STATE" = "REJECTED" ] || [ "$STATE" = "CONFIRMED" ] \
  || { echo "recovery did not terminate"; exit 1; }

echo "==> 6. Manual reversal of happy-path tx → REVERSED"
REV_RESP=$(curl -sf -b "$COOKIE_JAR" -X POST http://localhost:3000/reversals \
  -H 'content-type: application/json' \
  -d "{\"originalTxId\":\"$TXID\",\"reasonCode\":\"CUST\"}")
echo "$REV_RESP" | jq '.data | { reversal: .reversal.state, original: .original.state }'
[ "$(echo "$REV_RESP" | jq -r '.data.original.state')" = "REVERSED" ]

echo "==> 7. Idempotency: re-posting happy fixture returns the same transaction"
RESP=$(curl -sf -b "$COOKIE_JAR" -X POST http://localhost:3000/adapters-rest/process \
  -H 'content-type: application/json' \
  -d @scripts/fixtures/p4-happy.json)
NEW_ID=$(echo "$RESP" | jq -r '.data.transactionId')
echo "  original=$TXID  new=$NEW_ID  deduped=$(echo "$RESP" | jq -r '.data.deduped')"
[ "$NEW_ID" = "$TXID" ]

rm -f "$COOKIE_JAR"
echo
echo "PHASE 4 REST DEMO OK"
