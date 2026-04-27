# PHASE 3 — Participant Registry & Directory

**Mode:** Autonomous. Single master prompt, no per-block sign-off.

**Goal at end of phase:**
- Onboard a participant (bank, wallet operator, fintech) end-to-end with KYB, certificates, and certification gating.
- Register accounts under a participant (bank account, wallet, agent account).
- Register aliases (phone, email, Ghanacard PIN, merchant ID, custom handle) — one alias → one account; many aliases per account.
- Verify aliases (phone OTP, email link, Ghanacard via NIA fake, merchant TIN format).
- Move an alias from one PSP to another (alias portability).
- Resolve any input (account number + bank, alias, BIC) to an account via Name Enquiry.
- Run Confirmation of Payee with fuzzy match scoring — return `match` / `close-match` / `no-match`.

After this phase, Phase 4 (transactions) can finally do real work — it will resolve beneficiaries via this directory and reject payments to participants/accounts/aliases that don't exist or aren't valid.

---

## Architectural shape

```
┌─────────────────┐     ┌────────────┐     ┌───────────────┐
│  participants   │────▶│ directory  │◀────│   aliases     │
│  (KYB, certs)   │     │ (accounts) │     │ (proxy lookup)│
└─────────────────┘     └────────────┘     └───────────────┘
                              ▲                    ▲
                              └────────┬───────────┘
                                       │
                              ┌────────▼─────────┐
                              │   name-enquiry   │
                              │   + CoP scoring  │
                              └──────────────────┘
```

- `participants` is the registry. Owned by the operator. Customers don't see this.
- `directory` is the accounts table. Each account belongs to exactly one participant.
- `aliases` is the proxy lookup. Each alias resolves to one account at any given time. Aliases can move between PSPs (portability).
- `name-enquiry` is the public-ish API — given any input, return the canonical resolution + masked beneficiary name + CoP score if a name is supplied.

---

## NIA verification — pluggable interface

Real NIA integration is a deferred item (see SPEC.md deferred list). Phase 3 ships a software fake with the same interface so the real adapter slots in later without touching aliases code.

Interface (`modules/aliases/nia-client.js`):

```js
// In production, this calls https://verifyid.nia.gov.gh/persus or similar.
// In dev/test, the fake returns deterministic results.
export const createNiaClient = ({ mode }) => ({
  verify: async ({ ghanacardPin, firstName, lastName, dateOfBirth }) => ({
    status: 'EXACT_MATCH' | 'PARTIAL_MATCH' | 'NO_MATCH' | 'NOT_FOUND',
    fields: {
      firstName: boolean,
      lastName: boolean,
      dateOfBirth: boolean
    },
    canonical: { firstName, lastName, otherName, gender, dateOfBirth, address }
  })
});
```

The fake (`mode = 'fake'`) accepts a curated set of test PINs (e.g. `GHA-000000001-1` always matches `KOFI MENSAH`) and returns NOT_FOUND for everything else. `mode` defaults to `fake` and can be set via `config.niaMode` (`fake` | `live`).

---

## B3.1 — `modules/participants/`

**Purpose.** The registry of every bank, wallet operator, fintech, and PSP plugged into the rail. Holds participant metadata, status, certificates, endpoints, supported message formats, contact tree.

**Files to create.**
- `migrations/0007_participants.sql`
- `modules/participants/schema.js` (Joi for create/update/list)
- `modules/participants/model.js` (use `core/baseCrud.js`)
- `modules/participants/service.js`
- `modules/participants/controller.js`
- `modules/participants/routes.js`
- `modules/participants/server.js` (port 4201, key `participantsPort`)
- `modules/participants/index.js`
- `modules/participants/tests/participants.test.js`

**`migrations/0007_participants.sql`:**

```sql
CREATE TABLE IF NOT EXISTS participants (
  id                    UUID PRIMARY KEY,
  code                  TEXT UNIQUE NOT NULL,           -- e.g. 'BANK01', 'MOMO_MTN'
  name                  TEXT NOT NULL,
  legal_name            TEXT NOT NULL,
  type                  TEXT NOT NULL,                  -- 'BANK' | 'WALLET' | 'FINTECH' | 'PSP' | 'FOREIGN_RAIL'
  bic                   TEXT,                            -- 8 or 11 chars per ISO 9362
  country_code          CHAR(2) NOT NULL DEFAULT 'GH',
  status                TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'kyb' | 'certifying' | 'active' | 'suspended' | 'terminated'
  supported_formats     TEXT[] NOT NULL DEFAULT '{}',    -- ['ISO20022','REST'] etc.
  endpoints             JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { "inbound": "https://...", "callback": "https://..." }
  contact_email         CITEXT,
  contact_phone         TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  certified_at          TIMESTAMPTZ,
  activated_at          TIMESTAMPTZ,
  suspended_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS participants_status_idx ON participants(status);
CREATE INDEX IF NOT EXISTS participants_type_idx ON participants(type);
CREATE INDEX IF NOT EXISTS participants_bic_idx ON participants(bic) WHERE bic IS NOT NULL;
```

**Routes (all behind `requireAuth`):**
- `POST /participants` — create (status='pending')
- `GET /participants` — list with filters (status, type, country)
- `GET /participants/:code` — fetch
- `PATCH /participants/:code` — update fields (not status — status is a workflow, see B3.2)
- `GET /participants/:code/keys` — proxy to `crypto-keys.listActive`

**Service rules.**
- `create` writes audit `participant.created`.
- `update` writes audit `participant.updated` with changed-fields diff.
- Code is uppercase alphanumeric + underscore, 3–32 chars. Validated by Joi.
- BIC format validated by regex `/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/` when present.

**Exit checks:** standard.

---

## B3.2 — Participant onboarding workflow (KYB → certifying → active)

**Purpose.** State machine for taking a participant from `pending` → `kyb` → `certifying` → `active`. Each transition has gating (KYB documents collected; certification suite passed). Suspension and termination paths included.

**Files to create.**
- `migrations/0008_participant_onboarding.sql`
- `modules/participant-onboarding/model.js`
- `modules/participant-onboarding/service.js`
- `modules/participant-onboarding/controller.js`
- `modules/participant-onboarding/schema.js`
- `modules/participant-onboarding/routes.js`
- `modules/participant-onboarding/server.js` (port 4205, key `participantOnboardingPort`)
- `modules/participant-onboarding/index.js`
- `modules/participant-onboarding/tests/onboarding.test.js`

**`migrations/0008_participant_onboarding.sql`:**

```sql
CREATE TABLE IF NOT EXISTS participant_kyb (
  id                  UUID PRIMARY KEY,
  participant_id      UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL,            -- 'INCORPORATION', 'BOG_LICENSE', 'TAX_CERT', 'BENEFICIAL_OWNERS', 'AML_POLICY'
  doc_filename        TEXT NOT NULL,
  doc_sha256          TEXT NOT NULL,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by         UUID REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         UUID REFERENCES users(id),
  review_status       TEXT,                     -- 'approved' | 'rejected' | NULL pending
  review_note         TEXT,
  UNIQUE (participant_id, doc_type)
);

CREATE TABLE IF NOT EXISTS participant_certifications (
  id                  UUID PRIMARY KEY,
  participant_id      UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  test_suite          TEXT NOT NULL,           -- 'ENVELOPE_ROUNDTRIP', 'CREDIT_LEG', 'IDEMPOTENCY', 'NAME_ENQUIRY'
  status              TEXT NOT NULL,           -- 'queued' | 'running' | 'pass' | 'fail'
  ran_at              TIMESTAMPTZ,
  result              JSONB,
  UNIQUE (participant_id, test_suite)
);

CREATE INDEX IF NOT EXISTS participant_kyb_participant_idx ON participant_kyb(participant_id);
CREATE INDEX IF NOT EXISTS participant_certifications_participant_idx ON participant_certifications(participant_id);
```

**Required KYB doc types:** `INCORPORATION`, `BOG_LICENSE`, `TAX_CERT`, `BENEFICIAL_OWNERS`, `AML_POLICY`. All must be `approved` before `kyb → certifying` transition is allowed.

**Required certification suites for go-live:** `ENVELOPE_ROUNDTRIP`, `CREDIT_LEG`, `IDEMPOTENCY`, `NAME_ENQUIRY`. (Phase 3 only ships the framework + the first three; `NAME_ENQUIRY` cert lights up at end of Phase 3. `CREDIT_LEG` cert is a stub in Phase 3 and gets real after Phase 4.)

**State machine (enforced in service):**

```
pending ─(submit KYB docs)─▶ kyb
kyb     ─(all KYB approved)─▶ certifying
certifying ─(all cert suites pass)─▶ active
active  ─(operator action)─▶ suspended
active  ─(operator action)─▶ terminated
suspended ─(operator action)─▶ active
```

Reverse transitions other than `suspended → active` are forbidden.

**Routes:**
- `POST /participant-onboarding/:code/kyb` — multipart upload, doc_type in body, file via `express-fileupload`. Stores SHA-256 hash. (Real document storage out of scope — Phase 3 stores hash + filename only; Phase 10 may add object storage.)
- `POST /participant-onboarding/:code/kyb/:docType/review` — body `{status, note}`, requires admin auth, writes audit
- `POST /participant-onboarding/:code/transition` — body `{to: 'kyb' | 'certifying' | 'active' | 'suspended' | 'terminated'}`, validates state machine, sets timestamps, writes audit
- `POST /participant-onboarding/:code/certifications/:suite/run` — kicks off a cert run (stub harness; PASS/FAIL logged)
- `GET /participant-onboarding/:code` — full status: kyb docs + certifications + current state

**Service rules.**
- All transitions are atomic (`withTransaction`). On state change, also generate keys via `crypto-keys.generateForOwner` if not yet present (when transitioning to `certifying`).
- Activation also writes `participants.activated_at`.
- Audit events: `participant.kyb.uploaded`, `participant.kyb.reviewed`, `participant.transitioned`, `participant.certified`, `participant.suspended`, `participant.activated`, `participant.terminated`.

**Exit checks:** standard. Tests cover happy path (full onboarding from pending to active), rejection of invalid transitions, KYB review approval/rejection, cert suite pass/fail.

---

## B3.3 — `modules/directory/` (accounts)

**Purpose.** The accounts table. Every account in the country lives here: bank accounts, wallet accounts, agent floats, merchant settlement accounts. One account belongs to exactly one participant.

**Files to create.**
- `migrations/0009_directory.sql`
- `modules/directory/schema.js`
- `modules/directory/model.js` (uses baseCrud)
- `modules/directory/service.js`
- `modules/directory/controller.js`
- `modules/directory/routes.js`
- `modules/directory/server.js` (port 4202)
- `modules/directory/index.js`
- `modules/directory/tests/directory.test.js`

**`migrations/0009_directory.sql`:**

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id                  UUID PRIMARY KEY,
  participant_id      UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  participant_code    TEXT NOT NULL,                   -- denormalized for read speed
  account_type        TEXT NOT NULL,                   -- 'BANK_ACCOUNT' | 'WALLET' | 'AGENT_FLOAT' | 'MERCHANT_SETTLEMENT'
  account_number      TEXT NOT NULL,                   -- bank account number, MSISDN for wallet, etc.
  account_name        TEXT NOT NULL,                   -- registered name
  account_name_normalized TEXT NOT NULL,               -- uppercased + collapsed whitespace + transliterated, used for CoP
  currency            CHAR(3) NOT NULL DEFAULT 'GHS',
  status              TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'frozen' | 'closed'
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_code, account_number)
);

CREATE INDEX IF NOT EXISTS accounts_participant_idx ON accounts(participant_id);
CREATE INDEX IF NOT EXISTS accounts_type_idx ON accounts(account_type);
CREATE INDEX IF NOT EXISTS accounts_status_idx ON accounts(status);
CREATE INDEX IF NOT EXISTS accounts_name_norm_idx ON accounts USING gin (account_name_normalized gin_trgm_ops);
```

> Note: install `pg_trgm` extension. Add `CREATE EXTENSION IF NOT EXISTS pg_trgm;` at the top of `0009_directory.sql`. Used for fuzzy name matching in B3.8.

**Service rules.**
- `register({ participantCode, accountType, accountNumber, accountName, currency })` — validates participant is active, normalizes name (uppercase, NFD-normalize, strip diacritics, collapse whitespace), inserts.
- `freeze`, `unfreeze`, `close` — state transitions, audit events.
- `findByAccount({ participantCode, accountNumber })` — exact lookup.
- `searchByName({ participantCode, namePattern, limit })` — pg_trgm-backed fuzzy search.

**Routes (all behind `requireAuth`):**
- `POST /directory/accounts` — register
- `GET /directory/accounts` — list with filters
- `GET /directory/accounts/:participantCode/:accountNumber` — fetch
- `POST /directory/accounts/:participantCode/:accountNumber/freeze`
- `POST /directory/accounts/:participantCode/:accountNumber/unfreeze`
- `POST /directory/accounts/:participantCode/:accountNumber/close`

**Exit checks:** standard. Test that registration is rejected when participant not active, frozen accounts cannot be modified except unfreeze/close, account_name_normalized is computed correctly.

---

## B3.4 — `modules/aliases/` (the proxy lookup)

**Purpose.** One alias → one account at any given time. Many aliases per account allowed (one phone, one email, one Ghanacard, one merchant ID can all point to the same account). Aliases are typed; each type has its own validation.

**Files to create.**
- `migrations/0010_aliases.sql`
- `modules/aliases/schema.js`
- `modules/aliases/model.js`
- `modules/aliases/service.js`
- `modules/aliases/controller.js`
- `modules/aliases/routes.js`
- `modules/aliases/server.js` (port 4203)
- `modules/aliases/index.js`
- `modules/aliases/tests/aliases.test.js`

**`migrations/0010_aliases.sql`:**

```sql
CREATE TABLE IF NOT EXISTS aliases (
  id                  UUID PRIMARY KEY,
  alias_type          TEXT NOT NULL,                   -- 'PHONE' | 'EMAIL' | 'GHANACARD' | 'MERCHANT' | 'HANDLE'
  alias_value         TEXT NOT NULL,                   -- normalized form (E.164 phone, lowercased email, GHA-XXX-X, etc.)
  alias_value_display TEXT NOT NULL,                   -- as the user typed it
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  participant_code    TEXT NOT NULL,                   -- denormalized
  status              TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'verified' | 'revoked'
  verification_method TEXT,                            -- 'OTP' | 'EMAIL_LINK' | 'NIA' | 'TIN_FORMAT' | 'OPERATOR'
  verified_at         TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alias_type, alias_value, status) DEFERRABLE INITIALLY IMMEDIATE
);

-- Active alias must be globally unique among non-revoked rows.
CREATE UNIQUE INDEX IF NOT EXISTS aliases_active_uniq
  ON aliases (alias_type, alias_value)
  WHERE status IN ('pending', 'verified');

CREATE INDEX IF NOT EXISTS aliases_account_idx ON aliases(account_id);
CREATE INDEX IF NOT EXISTS aliases_participant_idx ON aliases(participant_code);
CREATE INDEX IF NOT EXISTS aliases_type_idx ON aliases(alias_type);
```

**Normalization rules per type (in service):**
- `PHONE`: parse to E.164. Default country GH (+233). Strip spaces, dashes, parens. Reject if not 12-15 digits after country code.
- `EMAIL`: lowercase, trim. Validate format with same Joi pattern as users.
- `GHANACARD`: must match `GHA-\d{9}-\d` (regex).
- `MERCHANT`: alphanumeric + dash, 6-20 chars, uppercase.
- `HANDLE`: lowercase alphanumeric + dot + underscore, 3-32 chars. Reserved words rejected (`admin`, `support`, `rail`, `ghipss`, `bog`, etc. — lock list in service).

**Routes:**
- `POST /aliases` — register (status='pending'), body `{aliasType, aliasValue, accountId}`. Returns alias with verification challenge if applicable.
- `GET /aliases/resolve` — query `?aliasType=PHONE&aliasValue=+233...`. Returns matching active+verified alias only, or 404. Public-ish endpoint (called by name-enquiry).
- `GET /aliases/by-account/:accountId` — list aliases for an account, requires auth.
- `POST /aliases/:id/revoke` — soft revoke (sets revoked_at, status='revoked').

**Exit checks:** standard. Test that uniqueness is enforced only among active rows (a revoked alias does not block a new one), normalization is correct per type, reserved handles rejected.

---

## B3.5 — Alias verification flows

**Purpose.** Move aliases from `pending` to `verified`. Each alias type has its own verification method. NIA verification uses the pluggable interface; phone OTP uses an in-memory dev provider; email link uses an in-memory dev provider. All three have the same external interface so real providers slot in later.

**Files to create.**
- `migrations/0011_alias_verification.sql`
- `modules/aliases/nia-client.js` (the pluggable NIA interface + fake)
- `modules/aliases/otp-client.js` (phone OTP — fake stores codes in DB)
- `modules/aliases/email-link-client.js` (email link — fake stores tokens in DB)
- `modules/aliases/verification-service.js` (orchestrates the three)
- `modules/aliases/verification-controller.js`
- `modules/aliases/verification-routes.js` (mounted at `/aliases/verify` from the same router)
- `modules/aliases/tests/verification.test.js`

**`migrations/0011_alias_verification.sql`:**

```sql
CREATE TABLE IF NOT EXISTS alias_verification_challenges (
  id                  UUID PRIMARY KEY,
  alias_id            UUID NOT NULL REFERENCES aliases(id) ON DELETE CASCADE,
  method              TEXT NOT NULL,            -- 'OTP' | 'EMAIL_LINK' | 'NIA'
  challenge_secret    TEXT NOT NULL,            -- OTP code, email token, or NIA-attested data hash
  expires_at          TIMESTAMPTZ NOT NULL,
  attempts            INT NOT NULL DEFAULT 0,
  consumed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alias_verif_alias_idx ON alias_verification_challenges(alias_id);
CREATE INDEX IF NOT EXISTS alias_verif_expires_idx ON alias_verification_challenges(expires_at);
```

**Per-type verification flow:**
- `PHONE`: service generates 6-digit OTP, expires in 5 minutes, max 3 attempts. POST `/aliases/verify/otp` with `{aliasId, code}` consumes it.
- `EMAIL`: service generates random URL-safe token, expires in 30 minutes, max 1 use. POST `/aliases/verify/email` with `{aliasId, token}` consumes it.
- `GHANACARD`: service calls `niaClient.verify`. If `EXACT_MATCH` and the registered `account_name` on the account matches the NIA `firstName + lastName` (using the same normalization as CoP), mark verified. If not, return failure with the mismatch reason. No "challenge" row is created — verification is one-shot.
- `MERCHANT`: format-only verification (TIN-shape). No external call. Status moves to `verified` at registration time when format passes. (Real TIN-vs-GRA verification is a future block.)
- `HANDLE`: `OPERATOR` method — operator manually confirms in admin console. No automated verification.

**`niaClient` interface (canonical, used in production with real adapter later):**

```js
{
  verify: async ({ ghanacardPin, firstName, lastName, dateOfBirth }) =>
    ({ status, fields, canonical })
}
```

The fake (`mode = 'fake'`) accepts a curated list:
- `GHA-000000001-1` → matches `KOFI MENSAH`
- `GHA-000000002-2` → matches `AMA OWUSU`
- `GHA-000000003-3` → matches `KWAME ASANTE`
- everything else → `NOT_FOUND`

**Exit checks:** standard. Tests: phone OTP happy path + wrong code + expired + max attempts; email link happy path + wrong token + expired; NIA exact match → verified; NIA mismatch → still pending with error; merchant format ok → verified directly.

---

## B3.6 — Alias portability across PSPs

**Purpose.** A customer can move their alias (phone, Ghanacard, merchant ID) from one participant to another. This is what UPI/PIX call alias portability and it's necessary for healthy competition.

**Files to create.**
- `migrations/0012_alias_portability.sql`
- `modules/aliases/portability-service.js`
- `modules/aliases/portability-controller.js`
- (extends `modules/aliases/routes.js` — same module)
- `modules/aliases/tests/portability.test.js`

**`migrations/0012_alias_portability.sql`:**

```sql
CREATE TABLE IF NOT EXISTS alias_portability_requests (
  id                  UUID PRIMARY KEY,
  alias_id            UUID NOT NULL REFERENCES aliases(id) ON DELETE RESTRICT,
  from_participant    TEXT NOT NULL,
  from_account_id     UUID NOT NULL,
  to_participant      TEXT NOT NULL,
  to_account_id       UUID NOT NULL,
  initiated_by        UUID NOT NULL REFERENCES users(id),
  status              TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'consented' | 'completed' | 'rejected' | 'expired'
  consent_method      TEXT,                              -- 'OTP' | 'NIA'
  consent_secret      TEXT,
  consent_expires_at  TIMESTAMPTZ,
  consented_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  rejected_reason     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alias_port_alias_idx ON alias_portability_requests(alias_id);
CREATE INDEX IF NOT EXISTS alias_port_status_idx ON alias_portability_requests(status);
```

**Flow:**
1. New PSP initiates `POST /aliases/:id/port` with `{toParticipant, toAccountId}`. System creates a portability request, generates an OTP (for phone) or NIA challenge (for Ghanacard) sent to the customer.
2. Customer consents via `POST /aliases/portability/:reqId/consent` with `{code}` or attests via NIA.
3. Within a single `withTransaction`: update the alias row's `account_id` and `participant_code` to the new target, mark request `completed`, write audit `alias.ported`.
4. Old PSP is notified via webhook (Phase 10 wiring; for now, just write an audit event).

**Cooling period:** an alias that has just been ported cannot be ported again for 7 days. Service enforces this — requests during cooling period are rejected.

**Exit checks:** standard. Test happy path port, rejection during cooling period, OTP consent, account_id change is atomic with request completion.

---

## B3.7 — `modules/name-enquiry/` (resolve any input → account)

**Purpose.** The public-ish API. Given any of {`accountNumber + participantCode`}, {`alias`}, {`bic + accountNumber`} — return a resolved account with masked beneficiary name. Returns nothing if not found, or if the account is not in `active` status.

**Files to create.**
- `modules/name-enquiry/schema.js`
- `modules/name-enquiry/service.js`
- `modules/name-enquiry/controller.js`
- `modules/name-enquiry/routes.js`
- `modules/name-enquiry/server.js` (port 4204)
- `modules/name-enquiry/index.js`
- `modules/name-enquiry/tests/name-enquiry.test.js`

No new migration. This module is purely composition: reads `directory` and `aliases` via their `index.js` exports.

**Routes:**
- `POST /name-enquiry/resolve` — body `{ input: { aliasType, aliasValue } | { participantCode, accountNumber } | { bic, accountNumber } }`. Returns `{ found: true, participantCode, accountNumber, accountType, maskedName, currency, status }` or `{ found: false }`.
- mTLS / participant-auth required (Phase 4 will tighten this; Phase 3 uses `requireAuth`).

**Name masking rule.** Take the first letter of each word, replace middle letters with `*`, keep the last letter visible:
- `KOFI MENSAH` → `K*** M*****H` (kept first + last letter of each word, asterisks in between sized to fit the original length)

Implement this in `core/strings.js` (new core file, authorized for B3.7 — same exception pattern as `core/json.js` in B2.3) so it's also available to fraud module later.

**Service rules.**
- Only return successful resolution if account status is `active` and (for aliases) alias status is `verified`.
- Increments a counter (per (participantCode, accountNumber) per day) — used for fraud signal in Phase 6. For Phase 3, just record the lookup as an audit event (`name_enquiry.executed` with `requestor_participant`, `target_participant_account_hash`).

**Exit checks:** standard. Tests cover each input shape, resolution to active account, rejection of frozen account, alias not verified → not found, name masking correctness on various lengths.

---

## B3.8 — Confirmation of Payee + Phase 3 exit gate

**Purpose.** The single biggest fraud killer. Customer types in a name, the rail compares it to the registered name on the destination account, returns `match` / `close-match` / `no-match`. Close-match returns the canonical name so the customer can confirm; no-match blocks unless the customer explicitly overrides.

**Files to create.**
- `modules/name-enquiry/cop-service.js`
- `modules/name-enquiry/cop-controller.js`
- (extends `modules/name-enquiry/routes.js`)
- `modules/name-enquiry/tests/cop.test.js`
- `scripts/demo-phase-3.sh`
- `tests/phase-3-integration.test.js`

**CoP scoring algorithm (locked here):**
1. Normalize both names: uppercase, NFD normalize, strip diacritics, collapse whitespace, sort tokens alphabetically. (`MENSAH KOFI` ≡ `KOFI MENSAH`.)
2. If normalized strings are equal → `match` (score 1.0).
3. Otherwise compute Jaro-Winkler similarity on the normalized strings.
4. Score thresholds:
   - ≥ 0.92 → `close-match` (return canonical name)
   - 0.75 ≤ s < 0.92 → `partial-match` (return canonical name with warning)
   - < 0.75 → `no-match`
5. If `no-match`, also do a token-level subset check (does typed name's tokens form a subset of canonical's tokens or vice versa?). If yes → `partial-match` (catches `KOFI` typed when registered is `KOFI MENSAH ASANTE`).

Implement Jaro-Winkler in `core/strings.js`. No external lib.

**Route:**
- `POST /name-enquiry/cop` — body `{ input: <same as resolve>, suppliedName: 'KOFI MENSAH' }`. Returns `{ found: true, score: 'match' | 'close-match' | 'partial-match' | 'no-match', similarity: 0.94, canonicalName: 'KOFI MENSAH ASANTE' (only for close/partial), maskedName: 'K*** M*****H' (always) }` or `{ found: false }` if account not found at all.

**`scripts/demo-phase-3.sh`** — runs full Phase 3 flow:
1. `pnpm reset && pnpm migrate && pnpm seed` (seed creates 3 demo participants and 6 demo accounts with NIA-aligned names)
2. Onboard a 4th participant end-to-end (KYB upload x5, review-approve x5, transition pending → kyb → certifying, run cert suites, transition to active)
3. Register an account under each participant
4. Register & verify a phone alias (OTP fake)
5. Register & verify a Ghanacard alias (NIA fake match)
6. Resolve via name-enquiry by alias and by account
7. CoP with exact name → `match`
8. CoP with `KOFI MENSEH` (typo) vs `KOFI MENSAH` → `close-match`
9. CoP with `JANE DOE` vs `KOFI MENSAH` → `no-match`
10. Print `PHASE 3 OK`

**Phase 3 exit gate:**
- `bash scripts/demo-phase-3.sh` — prints `PHASE 3 OK`
- `pnpm vitest run` — green; expect ~370+ total
- `pnpm lint`, `pnpm check-boundaries` — clean
- `pnpm reset && pnpm migrate && pnpm seed` — 12 migrations apply clean from empty DB
- `git log --oneline | head -30` — shows 8 phase-3 commits

When this passes, Phase 3 is done. Stop. Wait for "continue to Phase 4."

---

## What "PHASE 3 OK" unlocks

After Phase 3:
- The rail has a directory of every account and alias in the country.
- New participants can self-service onboard with KYB and certification gating.
- Customers can pay each other by phone, email, or Ghanacard PIN — no more "what's your account number".
- Confirmation of Payee tells the customer "yes that's the right person" before the money moves.
- Aliases can move between PSPs — competition is healthy.
- Phase 4 (transactions) can finally do real work — every payment instruction will resolve through this directory and reject payments to unknown or frozen accounts.
