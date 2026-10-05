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
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

# wait for /health to become responsive
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/health > /dev/null; then break; fi
  sleep 1
done

echo "--- /health"
curl -sf http://localhost:3000/health
echo

echo "--- POST /auth/login"
rm -f /tmp/sika-cookie
curl -sf -c /tmp/sika-cookie -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}'
echo

echo "--- GET /auth/me"
curl -sf -b /tmp/sika-cookie http://localhost:3000/auth/me
echo

echo "PHASE 1 OK"
