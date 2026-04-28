# Contract: Operator → Transactions

**Purpose.** Canonical reference page. Lists every payment-rail transaction the
operator can see, with filter/sort/paginate and a detail drawer for force-reject.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET  | `/transactions?participantCode=…&state=…&limit=…&offset=…` | List by participant + state |
| GET  | `/transactions/:id`                  | Single transaction + history |
| GET  | `/transactions/:id/history`          | State-history audit trail (`auth-events` is the UI alias) |
| POST | `/transactions/:id/force-reject`     | Operator kill-switch → REJECTED + audit |

The list endpoint requires `participantCode` (operator scope is enforced at the
auth layer; without it the response is `{ ok: true, data: { rows: [], total: 0 } }`).

## Captured response (real curl recipe)

```bash
pnpm reset && pnpm migrate && pnpm seed
node server.js &
SERVER_PID=$!
for i in $(seq 1 30); do curl -sf http://localhost:3000/health > /dev/null && break; sleep 0.2; done

# log in as the seed admin
curl -c /tmp/c -s -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}' > /dev/null

# list
curl -b /tmp/c 'http://localhost:3000/transactions?participantCode=BANK-001&limit=10' | jq

kill $SERVER_PID
```

Expected envelope shape (from `core/http.js → sendOk`):

```json
{
  "ok": true,
  "data": {
    "rows": [
      {
        "id": "019dcf96-9f7f-7f3c-a6f5-b0b412476f56",
        "envelope_id": "019dcf96-9f7e-7…",
        "end_to_end_id": "E2E-…",
        "state": "CONFIRMED",
        "rail_class": "DOMESTIC_INSTANT",
        "originator_participant": "BANK-001",
        "originator_account": "9999100001",
        "beneficiary_participant": "WALLET-002",
        "beneficiary_account": "0244000001",
        "amount_value": "15042",
        "amount_currency": "GHS",
        "response_code": "ACSC",
        "reason_code": "SUCCESS",
        "reason_message": null,
        "authorized_at": "2026-04-26T10:00:00.000Z",
        "routed_at":     "2026-04-26T10:00:00.012Z",
        "credit_leg_started_at": "2026-04-26T10:00:00.027Z",
        "confirmed_at": "2026-04-26T10:00:00.041Z",
        "rejected_at": null, "reversed_at": null, "failed_at": null,
        "reversal_transaction_id": null, "original_transaction_id": null,
        "attempts": 0, "next_attempt_at": null, "retry_policy_name": null,
        "operating_date": "2026-04-26",
        "fee_minor": "10",
        "fee_schedule_id": "default-2026",
        "created_at": "2026-04-26T10:00:00.000Z",
        "updated_at": "2026-04-26T10:00:00.041Z"
      }
    ],
    "total": 1
  }
}
```

## What the page displays → JSON path

| UI column        | JSON path                       |
|------------------|---------------------------------|
| Transaction id   | `data.rows[].id`                |
| Created          | `data.rows[].created_at`        |
| Amount           | `data.rows[].amount_value` + `data.rows[].amount_currency` (BigInt minor units → `Money` component) |
| Originator       | `data.rows[].originator_participant` |
| Beneficiary      | `data.rows[].beneficiary_participant` |
| State badge      | `data.rows[].state` → `status-map.toneFor()` |

Detail page (`/transactions/:id`) reads:
- `data.transaction.{rail_class, end_to_end_id, fee_minor, response_code, reason_code, …}`
- `data.history` from `/transactions/:id/history` is rendered through the
  `Timeline` composite (each entry: `from_state → to_state`, `reason_code`,
  `payload`, `occurred_at`, `occurred_by`).

## User actions → mutations

| Action | Endpoint |
|---|---|
| Force-reject (operator kill-switch) | `POST /transactions/:id/force-reject` with `{ reason }` |
| Refresh | re-runs `useListTransactionsQuery` |

The kill-switch writes a `transaction.terminated` audit event with payload
`{ reason, operatorId, fromState }` (see CLAUDE.md "Operator kill-switch in
every state machine").

## Anti-drift

The locked field names above came from `modules/transactions/model.js:1-11`
(`TX_COLS`). If the backend renames a column, the contract here AND the page's
`render` function must move together — never one without the other.
