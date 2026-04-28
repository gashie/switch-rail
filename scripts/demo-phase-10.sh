#!/usr/bin/env bash
# Phase 10 demo: builds all three React apps, regenerates the OpenAPI spec,
# brings the rail up, smoke-tests the citizen public-status endpoint, and
# previews each Vite app for a few seconds.
#
# Usage: bash scripts/demo-phase-10.sh
#
# Note: Lighthouse audits are not invoked here — they require a Chrome
# install plus the Lighthouse CLI. The hook is wired so an operator can
# add `npx lighthouse <url>` per app once Chrome is available.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Phase 10 demo"
echo "    Generating OpenAPI doc"
node scripts/generate-openapi.js

echo "    Copying openapi.json into operator/public so Vite serves it"
cp docs/openapi.json ui/operator/public/openapi.json

echo "==> Building all three React apps"
pnpm --filter @sika/operator     build
pnpm --filter @sika/participant build
pnpm --filter @sika/citizen     build

echo "==> Booting rail"
node server.js > /tmp/sika-phase-10.log 2>&1 &
RAIL_PID=$!
trap 'kill $RAIL_PID 2>/dev/null || true; for pid in ${PREVIEW_PIDS:-}; do kill $pid 2>/dev/null || true; done' EXIT

for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/health > /dev/null; then break; fi
  sleep 0.2
done
curl -sf http://localhost:3000/health > /dev/null
echo "    rail up on :3000"

echo "==> Smoke test: public status (no auth)"
curl -sf http://localhost:3000/public-status/summary | head -c 200
echo

echo "==> Smoke test: verify-receipt (expect found:false on a synthetic id)"
curl -sf -X POST http://localhost:3000/public-status/verify-receipt \
  -H 'content-type: application/json' \
  -d '{"transactionId":"00000000-0000-0000-0000-000000000000"}' | head -c 200
echo

echo "==> Smoke test: USSD callback (returns plain text)"
curl -sf -X POST http://localhost:3000/ussd/callback \
  -H 'content-type: application/json' \
  -d '{"sessionId":"D1","msisdn":"+233244000001","serviceCode":"*711#","text":""}'
echo

echo "==> Vite preview for each app (10s each)"
PREVIEW_PIDS=""
pnpm --filter @sika/operator preview --port 5173 > /tmp/sika-operator.log 2>&1 &
PREVIEW_PIDS="$PREVIEW_PIDS $!"
pnpm --filter @sika/participant preview --port 5174 > /tmp/sika-participant.log 2>&1 &
PREVIEW_PIDS="$PREVIEW_PIDS $!"
pnpm --filter @sika/citizen preview --port 5175 > /tmp/sika-citizen.log 2>&1 &
PREVIEW_PIDS="$PREVIEW_PIDS $!"
sleep 4

for url in http://localhost:5173 http://localhost:5174 http://localhost:5175; do
  if curl -sf "$url" > /dev/null; then
    echo "    OK   $url"
  else
    echo "    MISS $url"
  fi
done

echo "==> Done. Rail PID=$RAIL_PID, preview PIDs=$PREVIEW_PIDS"
echo "    Hold Ctrl-C to tear down."
sleep 5
