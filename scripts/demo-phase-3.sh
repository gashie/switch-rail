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

# A 4th participant fully onboarded end-to-end via HTTP.
DEMO_CODE="DEMO_PSP4"

echo "--- Register 4th participant (DEMO_PSP4)"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/participants \
  -H 'content-type: application/json' \
  -d "{\"code\":\"${DEMO_CODE}\",\"name\":\"Demo PSP Four\",\"legalName\":\"Demo PSP Four Ltd\",\"type\":\"PSP\",\"bic\":\"DEMOGHACDDD\",\"supportedFormats\":[\"REST\"]}" > /dev/null

echo "--- Upload all 5 KYB docs"
echo "synthetic kyb content" > /tmp/kyb.pdf
for DOC in INCORPORATION BOG_LICENSE TAX_CERT BENEFICIAL_OWNERS AML_POLICY; do
  curl -sf -b /tmp/sika-cookie -X POST "http://localhost:3000/participant-onboarding/${DEMO_CODE}/kyb" \
    -F "docType=${DOC}" -F file=@/tmp/kyb.pdf > /dev/null
  curl -sf -b /tmp/sika-cookie -X POST "http://localhost:3000/participant-onboarding/${DEMO_CODE}/kyb/${DOC}/review" \
    -H 'content-type: application/json' \
    -d '{"status":"approved"}' > /dev/null
done

echo "--- Transition kyb → certifying"
curl -sf -b /tmp/sika-cookie -X POST "http://localhost:3000/participant-onboarding/${DEMO_CODE}/transition" \
  -H 'content-type: application/json' \
  -d '{"to":"certifying"}' > /dev/null

echo "--- Run all 4 cert suites"
for SUITE in ENVELOPE_ROUNDTRIP CREDIT_LEG IDEMPOTENCY NAME_ENQUIRY; do
  curl -sf -b /tmp/sika-cookie -X POST "http://localhost:3000/participant-onboarding/${DEMO_CODE}/certifications/${SUITE}/run" > /dev/null
done

echo "--- Transition certifying → active"
curl -sf -b /tmp/sika-cookie -X POST "http://localhost:3000/participant-onboarding/${DEMO_CODE}/transition" \
  -H 'content-type: application/json' \
  -d '{"to":"active"}' > /dev/null

echo "--- Register account under DEMO_PSP4"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/directory/accounts \
  -H 'content-type: application/json' \
  -d "{\"participantCode\":\"${DEMO_CODE}\",\"accountType\":\"BANK_ACCOUNT\",\"accountNumber\":\"4000000001\",\"accountName\":\"Kofi Mensah\",\"currency\":\"GHS\"}" \
  > /tmp/p3.acct.json
ACCOUNT_ID=$(jq -r '.data.account.id' /tmp/p3.acct.json)
echo "ACCOUNT_ID=$ACCOUNT_ID"

echo "--- Register & verify a phone alias (OTP fake)"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/aliases \
  -H 'content-type: application/json' \
  -d "{\"aliasType\":\"PHONE\",\"aliasValue\":\"0244400001\",\"accountId\":\"${ACCOUNT_ID}\"}" \
  > /tmp/p3.alias.phone.json
PHONE_ALIAS_ID=$(jq -r '.data.alias.id' /tmp/p3.alias.phone.json)

curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/aliases/verify/otp/start \
  -H 'content-type: application/json' \
  -d "{\"aliasId\":\"${PHONE_ALIAS_ID}\"}" \
  > /tmp/p3.otp.start.json
DEV_CODE=$(jq -r '.data.devCode' /tmp/p3.otp.start.json)

curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/aliases/verify/otp \
  -H 'content-type: application/json' \
  -d "{\"aliasId\":\"${PHONE_ALIAS_ID}\",\"code\":\"${DEV_CODE}\"}" > /dev/null

echo "--- Register & verify a Ghanacard alias (NIA fake match)"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/aliases \
  -H 'content-type: application/json' \
  -d "{\"aliasType\":\"GHANACARD\",\"aliasValue\":\"GHA-000000001-1\",\"accountId\":\"${ACCOUNT_ID}\"}" \
  > /tmp/p3.alias.gha.json
GHA_ALIAS_ID=$(jq -r '.data.alias.id' /tmp/p3.alias.gha.json)

curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/aliases/verify/ghanacard \
  -H 'content-type: application/json' \
  -d "{\"aliasId\":\"${GHA_ALIAS_ID}\"}" > /dev/null

echo "--- Resolve via name-enquiry (by alias)"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/name-enquiry/resolve \
  -H 'content-type: application/json' \
  -d '{"input":{"aliasType":"PHONE","aliasValue":"0244400001"}}' \
  > /tmp/p3.resolve.json
test "$(jq -r '.data.found' /tmp/p3.resolve.json)" = "true"
test "$(jq -r '.data.maskedName' /tmp/p3.resolve.json)" = "K**I M****H"

echo "--- Resolve via name-enquiry (by participant + account number)"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/name-enquiry/resolve \
  -H 'content-type: application/json' \
  -d "{\"input\":{\"participantCode\":\"${DEMO_CODE}\",\"accountNumber\":\"4000000001\"}}" \
  > /tmp/p3.resolve2.json
test "$(jq -r '.data.found' /tmp/p3.resolve2.json)" = "true"

echo "--- CoP exact name → match"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/name-enquiry/cop \
  -H 'content-type: application/json' \
  -d "{\"input\":{\"participantCode\":\"${DEMO_CODE}\",\"accountNumber\":\"4000000001\"},\"suppliedName\":\"Kofi Mensah\"}" \
  > /tmp/p3.cop.match.json
test "$(jq -r '.data.score' /tmp/p3.cop.match.json)" = "match"

echo "--- CoP typo name → close-match"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/name-enquiry/cop \
  -H 'content-type: application/json' \
  -d "{\"input\":{\"participantCode\":\"${DEMO_CODE}\",\"accountNumber\":\"4000000001\"},\"suppliedName\":\"Kofi Menseh\"}" \
  > /tmp/p3.cop.close.json
test "$(jq -r '.data.score' /tmp/p3.cop.close.json)" = "close-match"

echo "--- CoP wrong name → no-match"
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/name-enquiry/cop \
  -H 'content-type: application/json' \
  -d "{\"input\":{\"participantCode\":\"${DEMO_CODE}\",\"accountNumber\":\"4000000001\"},\"suppliedName\":\"Jane Doe\"}" \
  > /tmp/p3.cop.no.json
test "$(jq -r '.data.score' /tmp/p3.cop.no.json)" = "no-match"

kill $SERVER_PID
wait $SERVER_PID 2>/dev/null || true
echo "PHASE 3 OK"
