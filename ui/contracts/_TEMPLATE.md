# Contract: <page name>

**Purpose.** One-sentence description of what this page is for.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/<endpoint>` | brief notes |

## Captured response (real curl output)

How to capture:
```bash
pnpm reset && pnpm migrate && pnpm seed
node server.js &
curl -c /tmp/c -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}' > /dev/null
curl -b /tmp/c 'http://localhost:3000/<endpoint>?limit=10'
```

```json
{
  "ok": true,
  "data": {
    "rows": []
  }
}
```

## What the page displays

- Field on screen → JSON path
- ...

## User actions → mutations

- Action → endpoint
- ...
