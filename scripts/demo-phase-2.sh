#!/usr/bin/env bash
set -e

pnpm reset
pnpm migrate
pnpm seed
pnpm vitest run
pnpm lint
pnpm check-boundaries

node server.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true" EXIT

for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/health > /dev/null; then break; fi
  sleep 0.2
done

echo "--- /health"
curl -sf http://localhost:3000/health
echo

echo "--- POST /auth/login"
rm -f /tmp/sika-cookie
curl -sf -c /tmp/sika-cookie -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}' > /dev/null

echo "--- REST adapter"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/adapters-rest/inbound \
  -H 'content-type: application/json' \
  -d @modules/adapters-rest/fixtures/sample.envelope.json \
  > /tmp/rest.out
test "$(jq -r '.ok' /tmp/rest.out)" = "true"

echo "--- ISO 20022 pacs.008 adapter"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/adapters-iso20022/inbound/pacs008 \
  -H 'content-type: application/xml' \
  --data-binary @modules/adapters-iso20022/fixtures/pacs008.sample.xml \
  > /tmp/iso.out
test "$(jq -r '.ok' /tmp/iso.out)" = "true"

echo "--- ISO 8583 adapter (0200, 1987)"
curl -sf -b /tmp/sika-cookie -X POST "http://localhost:3000/adapters-iso8583/inbound?version=1987" \
  -H 'content-type: application/octet-stream' \
  --data-binary @modules/adapters-iso8583/fixtures/0200.1987.bin \
  > /tmp/8583.out
test "$(jq -r '.ok' /tmp/8583.out)" = "true"

echo "--- SWIFT MT103 adapter"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/adapters-swift/inbound/mt103 \
  -H 'content-type: text/plain' \
  --data-binary @modules/adapters-swift/fixtures/mt103.sample.txt \
  > /tmp/mt.out
test "$(jq -r '.ok' /tmp/mt.out)" = "true"

echo "--- Bulk CSV adapter"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/adapters-bulk/csv \
  -F file=@modules/adapters-bulk/fixtures/payroll.10rows.csv \
  > /tmp/bulk.out
test "$(jq -r '.data.succeeded' /tmp/bulk.out)" = "10"

echo "--- Idempotency proof: re-post the REST envelope, expect deduped=true"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/adapters-rest/inbound \
  -H 'content-type: application/json' \
  -d @modules/adapters-rest/fixtures/sample.envelope.json \
  > /tmp/rest.dup.out
test "$(jq -r '.data.deduped' /tmp/rest.dup.out)" = "true"

kill $SERVER_PID
wait $SERVER_PID 2>/dev/null || true
echo "PHASE 2 OK"
