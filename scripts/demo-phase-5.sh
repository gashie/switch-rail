#!/usr/bin/env bash
# Phase 5 — full operating-day end-to-end demo:
# open day → liquidity top-up → 10 confirmed transactions → intraday cycle
# → 10 more transactions → EOD cutover → verify CLOSED + statements + recon
# clean → next operating day open. Prints PHASE 5 OK on success.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pnpm reset
pnpm migrate
pnpm seed > /tmp/p5-seed.json
pnpm vitest run
pnpm lint
pnpm check-boundaries

TX_TEST_MODE=true node server.js > /tmp/sika-server-p5.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if curl -sf http://localhost:3000/health > /dev/null; then break; fi
  sleep 0.2
done
curl -sf http://localhost:3000/health > /dev/null || {
  tail -30 /tmp/sika-server-p5.log
  exit 1
}

C=$(mktemp)
curl -sf -c "$C" -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}' > /dev/null

echo "==> 1. Open today's operating day"
TODAY=$(date +%F)
curl -sf -b "$C" "http://localhost:3000/eod/days/$TODAY" > /dev/null

echo "==> 2. Configure liquidity for P5BANK01 / P5BANK02"
for P in P5BANK01 P5BANK02; do
  curl -sf -b "$C" -X PUT "http://localhost:3000/liquidity/limits/$P/GHS" \
    -H 'content-type: application/json' \
    -d '{"prefundedMinor":"10000000","floorMinor":"0","ceilingMinor":"5000000","throttleThresholdPct":80}' > /dev/null
done

echo "==> 3. Run 10 confirmed transactions"
for i in $(seq 1 10); do
  ENV=$(node scripts/build-fixture.mjs envelope p5 "$i")
  curl -sf -b "$C" -X POST http://localhost:3000/adapters-rest/process \
    -H 'content-type: application/json' \
    -d "$ENV" > /dev/null
done

echo "==> 4. Verify ledger chain holds for today"
curl -sf -b "$C" "http://localhost:3000/ledger/verify/$TODAY" | jq -e '.data.ok == true' > /dev/null

echo "==> 5. Trigger intraday cycle"
CYCLE=$(curl -sf -b "$C" -X POST http://localhost:3000/settlement-cycle/cycles \
  -H 'content-type: application/json' \
  -d "{\"cycleType\":\"INTRADAY_NET\",\"currency\":\"GHS\",\"operatingDate\":\"$TODAY\",\"reason\":\"Phase 5 demo intraday\"}")
CYCLE_ID=$(echo "$CYCLE" | jq -r '.data.cycle.id')
curl -sf -b "$C" -X POST "http://localhost:3000/settlement-cycle/cycles/$CYCLE_ID/run" \
  -H 'content-type: application/json' \
  -d '{"confirmation":"phase-5-demo-intraday"}' > /dev/null

echo "==> 6. Verify positions are zero post-cycle"
P1=$(curl -sf -b "$C" "http://localhost:3000/settlement/positions/P5BANK01" | jq -r '.data | map(select(.currency=="GHS")) | .[0].positionMinor // "0"')
test "$P1" = "0"

echo "==> 7. Run 10 more transactions then EOD cutover"
for i in $(seq 11 20); do
  ENV=$(node scripts/build-fixture.mjs envelope p5 "$i")
  curl -sf -b "$C" -X POST http://localhost:3000/adapters-rest/process \
    -H 'content-type: application/json' \
    -d "$ENV" > /dev/null
done

CUTOVER_RESP=$(curl -sS -w '\nHTTP:%{http_code}\n' -b "$C" -X POST http://localhost:3000/eod/cutover \
  -H 'content-type: application/json' \
  -d "{\"operatingDate\":\"$TODAY\",\"confirmation\":\"phase-5-demo-eod\"}")
echo "  cutover response: $CUTOVER_RESP"
echo "$CUTOVER_RESP" | grep -q 'HTTP:201' || { echo "EOD cutover failed"; exit 1; }

echo "==> 8. Verify day is CLOSED, statements issued"
curl -sf -b "$C" "http://localhost:3000/eod/days/$TODAY" | jq -e '.data.state == "CLOSED"' > /dev/null
STMT=$(curl -sf -b "$C" "http://localhost:3000/eod/statements/$TODAY")
test "$(echo "$STMT" | jq '.data | length')" -ge 2

echo "==> 9. Run reconciliation against the identity feed (expect zero breaks)"
RECON=$(curl -sf -b "$C" -X POST http://localhost:3000/reconciliation/runs \
  -H 'content-type: application/json' \
  -d "{\"participantCode\":\"P5BANK01\",\"currency\":\"GHS\",\"operatingDate\":\"$TODAY\",\"runType\":\"EOD\"}")
echo "$RECON" | jq -e '.data.run.total_breaks == 0' > /dev/null

echo "==> 10. Verify next operating day is OPEN"
TOMORROW=$(date -d "$TODAY +1 day" +%F)
curl -sf -b "$C" "http://localhost:3000/eod/days/$TOMORROW" | jq -e '.data.state == "OPEN"' > /dev/null

rm -f "$C"
echo
echo "PHASE 5 OK"
