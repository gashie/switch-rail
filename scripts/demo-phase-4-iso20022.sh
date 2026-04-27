#!/usr/bin/env bash
# Phase 4 — ISO 20022 (pacs.008) end-to-end demo
#
# Same payment scenarios as the REST demo, this time over the ISO 20022 wire
# format. Proves the rail is truly format-agnostic at the lifecycle level.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Boot the monolith (assumes pnpm reset/migrate/seed already ran in the
# orchestrating demo-phase-4.sh).
TX_TEST_MODE=true node server.js > /tmp/sika-server-iso20022.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if curl -sf http://localhost:3000/health > /dev/null; then break; fi
  sleep 0.2
done
curl -sf http://localhost:3000/health > /dev/null || {
  echo "server did not come up; tail of log:"
  tail -30 /tmp/sika-server-iso20022.log
  exit 1
}

COOKIE_JAR="$(mktemp)"

echo "==> 1. Login"
curl -sf -c "$COOKIE_JAR" -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}' > /dev/null

# pacs.008 fixtures share the JSON envelopeIds from the REST demo, so we
# rewrite per-run with fresh ids to avoid envelope-level dedup against
# anything the REST demo persisted in the same DB.
NOW="$(date +%s)"
node scripts/build-fixture.mjs pacs008 scripts/fixtures/p4-happy.json "/tmp/p4-iso20022-happy-${NOW}.xml" "h${NOW}"
node scripts/build-fixture.mjs pacs008 scripts/fixtures/p4-insufficient.json "/tmp/p4-iso20022-insuf-${NOW}.xml" "i${NOW}"

echo "==> 2. Happy pacs.008 → CONFIRMED"
RESP=$(curl -sf -b "$COOKIE_JAR" -X POST http://localhost:3000/adapters-iso20022/process/pacs008 \
  -H 'content-type: application/xml' \
  --data-binary "@/tmp/p4-iso20022-happy-${NOW}.xml")
echo "$RESP" | jq '.data | { state, transactionId, responseCode, deduped }'
[ "$(echo "$RESP" | jq -r '.data.state')" = "CONFIRMED" ]

echo "==> 3. Insufficient pacs.008 → REJECTED with INSUFFICIENT_FUNDS"
RESP=$(curl -sf -b "$COOKIE_JAR" -X POST http://localhost:3000/adapters-iso20022/process/pacs008 \
  -H 'content-type: application/xml' \
  --data-binary "@/tmp/p4-iso20022-insuf-${NOW}.xml")
echo "$RESP" | jq '.data | { state, reasonCode }'
[ "$(echo "$RESP" | jq -r '.data.state')" = "REJECTED" ]
[ "$(echo "$RESP" | jq -r '.data.reasonCode')" = "INSUFFICIENT_FUNDS" ]

rm -f "$COOKIE_JAR"
echo
echo "PHASE 4 ISO 20022 DEMO OK"
