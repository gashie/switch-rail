# PHASE 1 — Foundation

**Mode:** Block-by-block sign-off. Human verifies each block before next.
**Goal at end of phase:** repo runs, migrations apply cleanly, auth works, audit log writes with hash chain, response envelopes flow, baseCrud scaffolds anything, boundary checker passes, every module can boot standalone via `node modules/<n>/server.js`, and the monolith `server.js` mounts everything cleanly.

After this phase, every subsequent phase runs **autonomously** off a single master prompt that reads CLAUDE.md, SPEC.md, the relevant PHASE-N.md, and the canonical modules built here.

---

## B1.1 — Repo init

**Purpose.** Bootstrap the repo with package.json, scripts, env scaffolding, README, and the four root-level docs (CLAUDE.md, SPEC.md, PROGRESS.md, this file already committed).

**Scope.** Create empty repo skeleton. No business logic. No SQL.

**Files to create.**
- `package.json` — see content below
- `.env.example`
- `.gitignore`
- `README.md` — pointer to CLAUDE.md
- `pnpm-workspace.yaml` (single-package, but reserved for future)
- `vitest.config.js`

**`package.json` exact content:**

```json
{
  "name": "sika-rail",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "migrate": "node scripts/migrate.js",
    "seed": "node scripts/seed.js",
    "reset": "node scripts/reset.js",
    "test": "vitest run",
    "lint": "eslint .",
    "check-boundaries": "node scripts/check-boundaries.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "cookie-parser": "^1.4.7",
    "express-fileupload": "^1.5.1",
    "joi": "^17.13.3",
    "pg": "^8.13.0",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0",
    "argon2": "^0.41.1",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "vitest": "^2.1.4",
    "eslint": "^9.13.0",
    "supertest": "^7.0.0"
  }
}
```

**`.env.example`:**

```
NODE_ENV=development
PORT=3000

# database
DATABASE_URL=postgres://sika:sika@localhost:5432/sika_rail

# crypto
COOKIE_SECRET=change_me_in_production_at_least_32_chars
ENCRYPTION_KEY=change_me_in_production_32_bytes_base64

# operator config (customizable per country)
OPERATOR_NAME=Sika
COUNTRY_CODE=GH
CURRENCY_DEFAULT=GHS
```

**`vitest.config.js`:**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    fileParallelism: false,        // sequential — DB tests need single owner
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  }
});
```

**Exit checks (paste output):**
- `pnpm install` — succeeds
- `node -e "console.log(process.version)"` — prints `v20.x.x` or higher
- `cat .env.example` — prints the env file
- `pnpm vitest run` — runs (zero tests, zero failures)

---

## B1.2 — `core/db.js` + migration runner

**Purpose.** PostgreSQL connection, transaction/client helpers, and the migration script that applies numbered SQL files from `migrations/` in order, idempotently.

**Files to create.**
- `core/db.js`
- `core/config.js` (the only file that reads `process.env`)
- `migrations/0001_init.sql` (just the migrations table itself)
- `scripts/migrate.js`
- `scripts/reset.js` (dev-only, drops public schema)
- `tests/db.test.js`

**`core/config.js`:**

```js
import 'dotenv/config';

const required = (key) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
};

export const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  databaseUrl: required('DATABASE_URL'),
  cookieSecret: required('COOKIE_SECRET'),
  encryptionKey: required('ENCRYPTION_KEY'),
  operatorName: process.env.OPERATOR_NAME || 'Sika',
  countryCode: process.env.COUNTRY_CODE || 'GH',
  currencyDefault: process.env.CURRENCY_DEFAULT || 'GHS'
});
```

**`core/db.js` shape:**

```js
import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

// numeric to BigInt
pg.types.setTypeParser(20, (v) => v == null ? null : BigInt(v)); // int8 -> BigInt

export const query = (text, params) => pool.query(text, params);

export const withClient = async (fn) => {
  const client = await pool.connect();
  try { return await fn(client); }
  finally { client.release(); }
};

export const withTransaction = async (fn) => {
  return withClient(async (c) => {
    await c.query('BEGIN');
    try {
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });
};

export const closePool = () => pool.end();
```

**`migrations/0001_init.sql`:**

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename     TEXT PRIMARY KEY,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum     TEXT NOT NULL
);
```

**`scripts/migrate.js` behavior:**
- Reads `migrations/*.sql` in lexicographic order.
- For each, computes SHA-256 of the file contents.
- If `schema_migrations` has the filename and checksum matches: skip.
- If filename present with different checksum: error out (migrations are immutable).
- Otherwise: run the SQL inside a transaction, then INSERT into `schema_migrations`.
- Print one line per migration: `applied 0001_init.sql` or `skipped 0001_init.sql (already applied)`.

**Exit checks:**
- `pnpm migrate` — applies `0001_init.sql`, prints applied
- `pnpm migrate` again — prints skipped
- `psql $DATABASE_URL -c "select * from schema_migrations"` — shows one row
- `pnpm vitest run tests/db.test.js` — green (test connects, runs SELECT 1, closes pool)

---

## B1.3 — Response envelopes, errors, context, http helpers

**Purpose.** Standardize response shape, error handling, request context, and HTTP middleware (validateBody, validateQuery, asyncHandler). Every controller in every module uses these.

**Files to create.**
- `core/responses.js`
- `core/errors.js`
- `core/context.js`
- `core/http.js`
- `tests/http.test.js`

**`core/responses.js`:**

```js
export const ok = (data) => ({ ok: true, data });
export const fail = (code, message, details) => ({ ok: false, error: { code, message, ...(details ? { details } : {}) } });
```

**`core/errors.js`:**

```js
export class AppError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const ERROR_CODES = Object.freeze({
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL'
});
```

> Exception: `AppError` uses `class` because the JavaScript `Error` constructor is the unavoidable third-party that must be extended via `class`. This is the only `class` allowed in the whole codebase.

**`core/context.js`:**

```js
import { randomUUID } from 'node:crypto';

export const attachContext = (req, _res, next) => {
  req.ctx = {
    requestId: req.headers['x-request-id'] || randomUUID(),
    user: null,           // set by auth middleware later
    participantId: null   // set by mTLS or session later
  };
  next();
};
```

**`core/http.js`:**

```js
import { ok, fail } from './responses.js';
import { AppError } from './errors.js';

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const validateBody = (schema) => (req, _res, next) => {
  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return next(new AppError('VALIDATION_FAILED', 'invalid body', 400, error.details));
  req.body = value;
  next();
};

export const validateQuery = (schema) => (req, _res, next) => {
  const { error, value } = schema.validate(req.query, { abortEarly: false, stripUnknown: true });
  if (error) return next(new AppError('VALIDATION_FAILED', 'invalid query', 400, error.details));
  req.query = value;
  next();
};

export const sendOk = (res, data, status = 200) => res.status(status).json(ok(data));

export const errorHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json(fail(err.code, err.message, err.details));
  }
  // unknown — log + 500
  return res.status(500).json(fail('INTERNAL', 'internal server error'));
};
```

**Exit checks:**
- `pnpm vitest run tests/http.test.js` — green (tests cover ok/fail shape, asyncHandler catches, validateBody rejects bad input, errorHandler maps AppError to status)
- Tiny smoke: spin up an Express app with one route, hit it with bad body, confirm `{"ok":false,"error":{"code":"VALIDATION_FAILED",...}}` shape.

---

## B1.4 — `core/money.js`, `core/uuid.js`

**Purpose.** Money math (BigInt, currency-aware, ISO 4217) and UUIDv7 generation. Used everywhere from Phase 2 onward.

**Files to create.**
- `core/money.js`
- `core/uuid.js`
- `tests/money.test.js`
- `tests/uuid.test.js`

**`core/money.js` requirements:**
- Stores amounts as BigInt minor units. `100n` = 1.00 GHS.
- `Money.from(amount, currency)` — accepts BigInt or string. Rejects Number unless integer.
- `add`, `sub`, `mul(scalar)`, `divFloor(scalar)`, `eq`, `lt`, `gt`, `isZero`, `negate`
- All arithmetic enforces same-currency. Cross-currency throws.
- ISO 4217 minor units table (GHS=2, USD=2, JPY=0, etc.) — enough entries for Ghana + neighbors + USD/EUR/GBP.
- `format(money)` — for display only, never used for storage.

**`core/uuid.js`:**
- `uuidv7()` — returns RFC-9562-compliant UUIDv7 string. Time-ordered. Use `node:crypto` for the randomness.

**Exit checks:**
- `pnpm vitest run tests/money.test.js` — green (covers add, sub, mul, currency mismatch, BigInt safety, format)
- `pnpm vitest run tests/uuid.test.js` — green (verifies version=7, time ordering across rapid succession, format)

---

## B1.5 — `core/crypto.js`

**Purpose.** Ed25519 signing, AES-256-GCM at-rest encryption, hash-chained audit primitives, password hashing helpers (argon2 wrapper).

**Files to create.**
- `core/crypto.js`
- `tests/crypto.test.js`

**API:**

```js
// Ed25519
generateEd25519Keypair() -> { publicKeyPem, privateKeyPem }
signEd25519(privateKeyPem, bytes) -> signatureB64
verifyEd25519(publicKeyPem, bytes, signatureB64) -> boolean

// AES-256-GCM
encryptGcm(plaintext, keyB64) -> { ciphertextB64, ivB64, tagB64 }
decryptGcm({ ciphertextB64, ivB64, tagB64 }, keyB64) -> plaintext

// hash chain
sha256(input) -> hexString
chainHash(prevHash, payload) -> hexString  // sha256(prevHash + sha256(payload))

// password
hashPassword(plain) -> argon2id hash string
verifyPassword(hash, plain) -> boolean
```

**Exit checks:**
- `pnpm vitest run tests/crypto.test.js` — green
  - sign+verify roundtrip
  - encrypt+decrypt roundtrip; tampered ciphertext fails
  - chainHash deterministic; differs on different prev
  - argon2 hash+verify roundtrip; wrong password fails

---

## B1.6 — `core/baseCrud.js`

**Purpose.** Generic CRUD factory. Every module uses this rather than hand-writing CRUD. Reduces boilerplate, enforces uniformity.

**Files to create.**
- `core/baseCrud.js`
- `tests/baseCrud.test.js`

**API:**

```js
const crud = createBaseCrud({
  table: 'participants',
  pk: 'id',
  columns: ['id', 'code', 'name', 'status', 'created_at', 'updated_at'],
  insertable: ['code', 'name', 'status'],
  updatable: ['name', 'status'],
  softDelete: false,        // optional: when true, sets deleted_at instead of DELETE
  defaultOrderBy: 'created_at DESC'
});

// Methods returned:
crud.create(client, { code, name, status })          -> row
crud.getById(client, id)                              -> row | null
crud.findOne(client, { where: { code } })             -> row | null
crud.findMany(client, { where, limit, offset, orderBy }) -> { rows, total }
crud.update(client, id, { name })                     -> row
crud.remove(client, id)                               -> { removed: true }
crud.upsert(client, conflictCols, values)             -> row
```

- All methods accept a `client` (so a service can wrap calls in `withTransaction`).
- All methods use parameterized queries.
- `findMany` paginates with `limit`/`offset` and returns `total` from a separate `count(*)` query.
- Auto-generates `id` (uuidv7) on create if not provided.
- Auto-sets `updated_at = now()` on update.

**Exit checks:**
- `pnpm vitest run tests/baseCrud.test.js` — green. Test against a temporary table created in the test setup. Cover create, get, find, update, remove, upsert, soft-delete behavior, pagination.

---

## B1.7 — `modules/auth/`

**Purpose.** Cookie-based session auth for the operator console. Login, logout, who-am-I, password change. mTLS-ready (the mTLS handshake itself is at the reverse proxy / `crypto-keys` module; this module handles internal user sessions).

**Files to create.**
- `migrations/0002_auth.sql`
- `modules/auth/model.js`
- `modules/auth/service.js`
- `modules/auth/controller.js`
- `modules/auth/schema.js`
- `modules/auth/routes.js`
- `modules/auth/server.js`
- `modules/auth/index.js`
- `modules/auth/middleware.js`  (`requireAuth`)
- `modules/auth/tests/auth.test.js`

**`migrations/0002_auth.sql`:**

```sql
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
```

> Note: install the `citext` extension. Add `CREATE EXTENSION IF NOT EXISTS citext;` to `0001_init.sql`. Since 0001 is already committed, instead add it as the first line of `0002_auth.sql`.

**Routes:**
- `POST /auth/login` — body `{email, password}`, sets cookie `sika_session`, returns `{user}`
- `POST /auth/logout` — clears session
- `GET /auth/me` — returns current user
- `POST /auth/password` — body `{current, new}`, requires auth

**`requireAuth` middleware:** reads cookie, looks up session, attaches `req.ctx.user`. 401 with `UNAUTHORIZED` envelope on failure.

**Standalone server** (`server.js` inside `modules/auth/`):
```js
import express from 'express';
import cookieParser from 'cookie-parser';
import { attachContext } from '../../core/context.js';
import { errorHandler } from '../../core/http.js';
import { ok } from '../../core/responses.js';
import routes from './routes.js';
import { config } from '../../core/config.js';

const app = express();
app.use(express.json());
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_, res) => res.json(ok({ module: 'auth', status: 'up' })));
app.use('/auth', routes);
app.use(errorHandler);

const port = Number(process.env.AUTH_PORT || 4001);
app.listen(port, () => console.log(`auth on ${port}`));
```

**Exit checks (paste output):**
- `pnpm migrate` clean
- `pnpm vitest run modules/auth` — green; covers login success, login wrong password, /me with and without cookie, logout, password change
- `node modules/auth/server.js &` then `curl http://localhost:4001/health` returns `{"ok":true,"data":{"module":"auth","status":"up"}}`
- `curl -i -c /tmp/c -X POST http://localhost:4001/auth/login -H 'content-type: application/json' -d '{"email":"...","password":"..."}'` (after seeding a user) returns Set-Cookie + 200
- `curl -b /tmp/c http://localhost:4001/auth/me` returns the user

---

## B1.8 — `modules/audit/`

**Purpose.** Append-only event log with daily hash chain. Every state-changing operation in every module emits one or more audit events. The hash chain makes tampering detectable.

**Files to create.**
- `migrations/0003_audit.sql`
- `modules/audit/model.js`
- `modules/audit/service.js`
- `modules/audit/controller.js`
- `modules/audit/schema.js`
- `modules/audit/routes.js` (`GET /audit?from=&to=&actor=` admin only)
- `modules/audit/server.js`
- `modules/audit/index.js`
- `modules/audit/tests/audit.test.js`

**`migrations/0003_audit.sql`:**

```sql
CREATE TABLE IF NOT EXISTS audit_events (
  id            UUID PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  day           DATE NOT NULL,
  seq           BIGSERIAL UNIQUE,                -- ordering within the day's chain
  actor_type    TEXT NOT NULL,                   -- 'user' | 'participant' | 'system'
  actor_id      TEXT,
  event_type    TEXT NOT NULL,                   -- 'auth.login' | 'participant.created' | ...
  resource_type TEXT,
  resource_id   TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash     TEXT NOT NULL,                   -- hex
  hash          TEXT NOT NULL                    -- sha256(prev_hash || sha256(payload))
);

CREATE INDEX IF NOT EXISTS audit_day_idx ON audit_events(day);
CREATE INDEX IF NOT EXISTS audit_event_idx ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS audit_resource_idx ON audit_events(resource_type, resource_id);

CREATE TABLE IF NOT EXISTS audit_day_anchor (
  day        DATE PRIMARY KEY,
  first_seq  BIGINT NOT NULL,
  last_seq   BIGINT NOT NULL,
  last_hash  TEXT NOT NULL,
  closed_at  TIMESTAMPTZ                         -- set at EOD, locks the day
);
```

**Service API:**
```js
record(client, { actorType, actorId, eventType, resourceType, resourceId, payload }) -> row
verifyDay(day) -> { ok: true } | { ok: false, brokenAtSeq }
```

- `record` runs inside the caller's transaction (takes a `client`).
- It looks up the previous event's `hash` (within the same `day`), computes `chainHash(prev, payload)`, inserts.
- `verifyDay` walks the day's events in `seq` order and re-verifies.

**Exit checks:**
- `pnpm vitest run modules/audit` — green
  - Inserts 100 events; verifyDay returns `ok: true`
  - Tamper one row's payload directly via SQL; verifyDay returns `ok: false, brokenAtSeq`
- `curl http://localhost:4002/audit?from=2026-04-26&to=2026-04-26` returns events

---

## B1.9 — `modules/crypto-keys/`

**Purpose.** Custody Ed25519 signing keypairs for participants. The rail signs every outbound message; participants sign every inbound message. Key rotation is supported. Keys are stored encrypted at rest (AES-256-GCM with a master key from env). For real production, this module is the abstraction over a real HSM — for now, the implementation is software-backed with the same API.

**Files to create.**
- `migrations/0004_crypto_keys.sql`
- `modules/crypto-keys/model.js`
- `modules/crypto-keys/service.js`
- `modules/crypto-keys/controller.js`
- `modules/crypto-keys/schema.js`
- `modules/crypto-keys/routes.js`
- `modules/crypto-keys/server.js`
- `modules/crypto-keys/index.js`
- `modules/crypto-keys/tests/crypto-keys.test.js`

**`migrations/0004_crypto_keys.sql`:**

```sql
CREATE TABLE IF NOT EXISTS signing_keys (
  id                    UUID PRIMARY KEY,
  owner_type            TEXT NOT NULL,        -- 'rail' | 'participant'
  owner_id              TEXT,                  -- participant code, or null for the rail itself
  kid                   TEXT UNIQUE NOT NULL,  -- key id used in signature headers
  public_key_pem        TEXT NOT NULL,
  private_key_ciphertext TEXT NOT NULL,
  private_key_iv        TEXT NOT NULL,
  private_key_tag       TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active', -- 'active' | 'rotated' | 'revoked'
  activated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at            TIMESTAMPTZ,
  revoked_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS signing_keys_owner_idx ON signing_keys(owner_type, owner_id, status);
```

**Service API:**
```js
generateForOwner({ ownerType, ownerId }) -> { kid, publicKeyPem }
sign({ kid, payload }) -> { signature, alg: 'Ed25519', kid }
verify({ kid, payload, signature }) -> boolean
rotate({ ownerType, ownerId }) -> { newKid, publicKeyPem }
revoke({ kid }) -> { revoked: true }
listActive({ ownerType, ownerId }) -> [{ kid, publicKeyPem, status }]
```

- Private keys are encrypted before insertion using `core/crypto.encryptGcm` with `config.encryptionKey`.
- `sign` decrypts in memory only.
- The rail itself owns at least one active key from boot; `migrate` -> `seed` provisions the rail's first key in dev.

**Exit checks:**
- `pnpm vitest run modules/crypto-keys` — green: generate, sign, verify, rotate, revoke, list
- `curl http://localhost:4003/crypto-keys/rail/active` returns the rail's active public keys

---

## B1.10 — `scripts/check-boundaries.js` + `server.js` monolith + Phase 1 exit gate

**Purpose.** The anti-drift script that fails the commit on bad patterns. The monolith entry point that mounts every module's routes. The Phase 1 final gate.

**Files to create.**
- `scripts/check-boundaries.js`
- `server.js`
- `scripts/seed.js`
- `scripts/demo-phase-1.sh`

**`scripts/check-boundaries.js` rules — exits 1 on any violation:**

| Rule | What it checks |
|---|---|
| no-class | Forbids `class ` keyword anywhere except `core/errors.js` (the AppError exception). |
| no-typescript | Fails if any `.ts`, `.tsx`, `.d.ts`, or `tsconfig.json` exists. |
| no-todos | Fails if any `// TODO`, `// FIXME`, `it.skip`, `it.todo`, `throw new Error('not implemented')` is found. |
| no-cross-module-internals | Inside `modules/A/`, no `import` from `../B/service.js`, `../B/model.js`, `../B/controller.js`. Only `../B/index.js` is allowed. |
| no-sql-outside-model | Inside `modules/<n>/service.js` or `controller.js`, forbids string literals matching `/\b(SELECT|INSERT|UPDATE|DELETE)\b/i` other than in JSDoc. |
| no-process-env-outside-config | `process.env` is only allowed in `core/config.js` and the `core/db.js` `pg.types.setTypeParser` setup. |
| no-res-methods-in-controller | `controller.js` files may not call `res.json`, `res.status`, `res.send`, `res.cookie`, `res.clearCookie`. They call `sendOk` from `core/http.js`. |
| no-joi-in-controller | `controller.js` files may not import `joi`. |

The script walks the file tree, parses each file as text, applies the rules, prints violations, exits non-zero if any.

**`server.js`:**
- Loads config.
- Builds Express app: json, cookie-parser, fileupload, attachContext.
- `GET /health` → ok envelope with `{ operatorName, countryCode, currencyDefault }`
- For each module: `import routes from './modules/<n>/routes.js'; app.use('/<n>', routes);`
- `app.use(errorHandler)` last.

**`scripts/seed.js`** (dev only): creates one admin user (`admin@sika.local` / `admin1234`), provisions the rail's signing keypair, writes a `seed.json` summary.

**`scripts/demo-phase-1.sh`:**
```bash
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
sleep 2
curl -sf http://localhost:3000/health
curl -sf -c /tmp/sika-cookie -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}'
curl -sf -b /tmp/sika-cookie http://localhost:3000/auth/me
kill $SERVER_PID
echo "PHASE 1 OK"
```

**Phase 1 exit gate (paste output):**
- `bash scripts/demo-phase-1.sh` — prints `PHASE 1 OK`
- `pnpm check-boundaries` — clean
- `git log --oneline | head -10` — shows 10 commits, one per block

When this passes, Phase 1 is done. Stop. Wait for the human to say "continue to Phase 2."

---

## What "PHASE 1 OK" unlocks

After Phase 1 ships, the rail has:
- A repo that boots and self-seeds in one command
- A migration system that's safe and append-only
- Response envelopes used by every controller from now on
- An audit log with daily hash chain that every module will write to from Phase 2 onward
- Auth that every operator-facing route can plug in via `requireAuth`
- Crypto keys for the rail and every future participant
- A boundary checker that prevents drift mechanically
- The proven module shape every Phase 2+ module will copy

From Phase 2, the human pastes one autonomous master prompt per phase and walks away.
