# CLAUDE.md — Phase 1 Patch

Append the following three sections to the bottom of your existing `CLAUDE.md`. They lock in the canonical patterns that emerged from Phase 1 deviations #3, #4, and #10. Phase 2 onward inherits these automatically.

Also: **move** `PHASE-1.md` from repo root into `PHASES/`. CLAUDE.md and the master prompt template both reference `PHASES/PHASE-N.md`. Quick fix:

```bash
git mv PHASE-1.md PHASES/PHASE-1.md
git commit -m "chore: move PHASE-1.md into PHASES/ to match CLAUDE.md path"
```

Then append the three sections below to `CLAUDE.md`.

---

## The port convention — every standalone server uses this

Every module that ships a standalone `server.js` must:

1. Read its port from `core/config.js` only. **Never** `process.env.<MODULE>_PORT` directly — that breaks `no-process-env-outside-config`.
2. Add a key to `config.js` named `<module>Port` (camelCase). Sourced from env `<MODULE>_PORT` with a numeric default in the 4xxx range.
3. Use the keys already allocated:

| Module | env var | default port | config key |
|---|---|---|---|
| auth | `AUTH_PORT` | 4001 | `authPort` |
| audit | `AUDIT_PORT` | 4002 | `auditPort` |
| crypto-keys | `CRYPTO_KEYS_PORT` | 4003 | `cryptoKeysPort` |
| envelope | `ENVELOPE_PORT` | 4101 | `envelopePort` |
| adapters-rest | `ADAPTERS_REST_PORT` | 4102 | `adaptersRestPort` |
| adapters-iso20022 | `ADAPTERS_ISO20022_PORT` | 4103 | `adaptersIso20022Port` |
| adapters-iso8583 | `ADAPTERS_ISO8583_PORT` | 4104 | `adaptersIso8583Port` |
| adapters-swift | `ADAPTERS_SWIFT_PORT` | 4105 | `adaptersSwiftPort` |
| adapters-bulk | `ADAPTERS_BULK_PORT` | 4106 | `adaptersBulkPort` |
| participants | `PARTICIPANTS_PORT` | 4201 | `participantsPort` |
| directory | `DIRECTORY_PORT` | 4202 | `directoryPort` |
| aliases | `ALIASES_PORT` | 4203 | `aliasesPort` |
| name-enquiry | `NAME_ENQUIRY_PORT` | 4204 | `nameEnquiryPort` |

Future phases pick the next free port in their range. Range allocation: 41xx envelope/adapters, 42xx directory, 43xx transactions/routing, 44xx ledger/settlement, 45xx fraud, 46xx disputes, 47xx overlays, 48xx cross-border, 49xx ops/citizen.

## The cookie/response helper convention

Controllers may not call `res.cookie`, `res.clearCookie`, `res.json`, `res.status`, or `res.send` directly. The `no-res-methods-in-controller` rule forbids it.

For cookies, use the helpers in `core/http.js` introduced in B1.7:

- `setSessionCookie(res, name, value, options)`
- `clearSessionCookie(res, name)`

For response bodies, use `sendOk(res, data, status)` already in `core/http.js`.

If a future block needs a new helper (e.g. `sendStream(res, stream)` for file downloads), add it to `core/http.js` rather than calling `res.*` from a controller.

## The standalone server boot/health convention

Every standalone `server.js` in a module must use the **poll-with-timeout** pattern in its demo scripts, not `sleep N`. Sleep is unreliable on cold boots.

The canonical wait-for-health snippet for any phase demo script:

```bash
node modules/<n>/server.js &
SERVER_PID=$!
for i in $(seq 1 30); do
  if curl -sf http://localhost:<port>/health > /dev/null; then break; fi
  sleep 0.2
done
curl -sf http://localhost:<port>/health   # actually verify response
# ... rest of test ...
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null || true
```

Phase demo scripts (`scripts/demo-phase-N.sh`) all follow this pattern.
