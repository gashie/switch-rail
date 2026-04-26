# PHASE 2 — Message Envelope & Adapters

**Mode:** Autonomous. Single master prompt, no per-block sign-off.
**Goal at end of phase:** A payment instruction in REST/JSON, ISO 20022 XML (pacs.008.001.14), ISO 8583 (1987/1993/2003), SWIFT MT (MT103/MT202), or bulk file (CSV/XLSX/pain.001) becomes the same canonical internal envelope. Round-trips both ways. The envelope is the only shape every later phase ever sees.

**Why this is the foundation of Phase 3 onward.** From Phase 3 forward, no module deals in raw wire formats. Routing, fraud, settlement, disputes, cross-border — they all read and write envelopes. Adapters live at the edge. This separation is what makes the rail format-agnostic.

---

## Architectural shape

```
┌──────────────┐     ┌──────────┐     ┌──────────────┐
│   Adapters   │────▶│ Envelope │────▶│  Rail Core   │
│              │◀────│          │◀────│              │
└──────────────┘     └──────────┘     └──────────────┘
   parse(raw)        canonical          downstream
   format(env)       JSON shape         modules
```

- `modules/envelope/` owns the canonical schema (Joi), persistence table, idempotency-aware insert.
- `modules/adapters-<format>/` — one module per format. Each exports `parse(raw) -> envelope` and `format(envelope) -> raw`. Each can also boot as a standalone HTTP server that accepts the wire format on its inbound port (e.g. ISO 8583 banks POST raw bitmap-encoded payloads to `/iso8583/parse` and get back the canonical envelope). The monolith mounts all adapters.
- Adapters depend on `envelope/index.js`. They do not import each other.

---

## Canonical envelope shape (locked in B2.1)

```js
{
  envelopeId:        'uuid-v7',                // rail-assigned, unique
  msgVersion:        '1.0',                    // envelope schema version
  msgType:           'CRDT_TRF',               // CRDT_TRF | PMT_STATUS | PMT_RETURN | PMT_REVERSAL | NAME_ENQ
  createdAt:         '2026-04-26T12:34:56.789Z',
  sourceFormat:      'ISO20022',               // ISO20022 | ISO8583 | REST | SWIFT_MT | BULK_CSV | BULK_XLSX | BULK_PAIN001
  sourceMessageId:   'orig-msg-id-from-wire',  // pacs.008 GrpHdr/MsgId, ISO 8583 STAN, etc.
  endToEndId:        'uuid-v7-or-uetr',        // UETR if from ISO 20022; UUIDv7 otherwise
  idempotencyKey:    'client-supplied-key',    // required for inbound; rail dedupes on this
  originator: {
    participantCode: 'BANK01',
    accountId:       '0123456789',             // account number, MSISDN, etc.
    accountType:     'BANK_ACCOUNT',           // BANK_ACCOUNT | WALLET | ALIAS
    name:            'KOFI MENSAH',
    bic:             'BANK01GHACXXX',          // optional
    countryCode:     'GH'
  },
  beneficiary: {
    participantCode: 'BANK02',
    accountId:       '9876543210',
    accountType:     'BANK_ACCOUNT',
    name:            'AMA OWUSU',
    bic:             'BANK02GHACXXX',
    countryCode:     'GH'
  },
  amount: {
    value:           '15000',                  // BigInt minor units, serialized as string in JSON
    currency:        'GHS'
  },
  fee: {
    value:           '50',
    currency:        'GHS',
    bearer:          'DEBT'                    // DEBT | CRED | SHAR per ISO 20022
  } | null,
  reference:         'INV-2026-001',           // remittance reference (free-text or structured)
  remittance:        'Payment for invoice 001', // unstructured remittance info, ≤140 chars per line
  purposeCode:       'GDDS',                    // ISO 20022 4-char purpose code (optional)
  settlementMethod:  'CLRG',                    // CLRG | COVE | INDA | INGA
  settlementDate:    '2026-04-26',              // YYYY-MM-DD
  metadata:          {},                        // adapter-specific bag, never read by rail core
  signature: {
    kid:             'rail-key-id',
    alg:             'Ed25519',
    sigB64:          'base64-signature'
  } | null
}
```

All BigInt values serialize as strings in JSON. The envelope module's Joi schema enforces this.

---

## B2.1 — Envelope module: schema, validators, factory

**Purpose.** Define the canonical envelope as a Joi schema. Provide a factory `createEnvelope({...})` that validates and returns a frozen envelope. Provide validators `validateEnvelope(env)` and `assertEnvelope(env)` (latter throws on invalid).

**Files to create.**
- `modules/envelope/schema.js` — Joi schema for the envelope, plus enums (msgType, sourceFormat, accountType, settlementMethod, etc.)
- `modules/envelope/factory.js` — `createEnvelope`, `freezeEnvelope`
- `modules/envelope/validators.js` — `validateEnvelope`, `assertEnvelope`
- `modules/envelope/index.js` — named exports for cross-module use
- `modules/envelope/tests/envelope.test.js`

**No DB in this block.** B2.2 adds persistence.

**Joi notes.**
- BigInt values: define as `Joi.string().pattern(/^\d+$/).custom((v) => v)` (string of digits). Numbers are forbidden for amounts.
- `msgVersion`: must be `'1.0'` (literal).
- Enums use `Joi.string().valid(...)`. Define enum arrays in `schema.js` and export them so adapters can reuse.
- `idempotencyKey`: required, string, 8-128 chars.
- `envelopeId`: must be UUID v7 (validate via custom rule using `core/uuid.js` or just regex on RFC 9562 v7 layout).
- Reject unknown keys at the top level.

**Exit checks (paste output):**
- `pnpm vitest run modules/envelope` — green; covers happy path, reject unknown keys, reject Number for amount.value, reject bad msgType, reject missing idempotencyKey, freeze test.
- `pnpm lint` clean.
- `pnpm check-boundaries` clean.

---

## B2.2 — Envelope persistence + idempotency

**Purpose.** Persist every inbound envelope. Dedupe on `idempotencyKey` per `originator.participantCode` over a 7-day window. Return the original envelope on duplicate without changing state.

**Files to create.**
- `migrations/0005_envelopes.sql`
- `modules/envelope/model.js` — `insert`, `findByIdempotencyKey`, `findByEnvelopeId`
- `modules/envelope/service.js` — `ingest(env, client)` returns `{ envelope, deduped: boolean }`
- `modules/envelope/controller.js` — minimal: `POST /envelope` accepts a canonical envelope, calls `ingest`, returns the persisted envelope
- `modules/envelope/routes.js`
- `modules/envelope/server.js` (port 4101, key `envelopePort`)
- `modules/envelope/tests/envelope.persistence.test.js`

**`migrations/0005_envelopes.sql`:**

```sql
CREATE TABLE IF NOT EXISTS envelopes (
  envelope_id          UUID PRIMARY KEY,
  msg_version          TEXT NOT NULL,
  msg_type             TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_format        TEXT NOT NULL,
  source_message_id    TEXT,
  end_to_end_id        TEXT NOT NULL,
  idempotency_key      TEXT NOT NULL,
  originator_participant TEXT NOT NULL,
  originator_account   TEXT NOT NULL,
  originator_country   TEXT,
  beneficiary_participant TEXT NOT NULL,
  beneficiary_account  TEXT NOT NULL,
  beneficiary_country  TEXT,
  amount_value         NUMERIC(38,0) NOT NULL,
  amount_currency      CHAR(3) NOT NULL,
  fee_value            NUMERIC(38,0),
  fee_currency         CHAR(3),
  fee_bearer           TEXT,
  reference            TEXT,
  remittance           TEXT,
  purpose_code         TEXT,
  settlement_method    TEXT,
  settlement_date      DATE,
  envelope             JSONB NOT NULL,
  signature            JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS envelopes_idempotency_uniq
  ON envelopes (originator_participant, idempotency_key);

CREATE INDEX IF NOT EXISTS envelopes_created_idx ON envelopes(created_at DESC);
CREATE INDEX IF NOT EXISTS envelopes_originator_idx ON envelopes(originator_participant);
CREATE INDEX IF NOT EXISTS envelopes_beneficiary_idx ON envelopes(beneficiary_participant);
```

Numeric column choice: `NUMERIC(38,0)` stores BigInt minor units up to 10^38 — well above any reasonable money value. Re-read in JS as `BigInt(rowValue)`.

**Service rules.**
- `ingest` runs inside a transaction. First, `SELECT ... FOR UPDATE` on the unique index using `(originator_participant, idempotency_key)`. If found and row's `envelope.amount` etc. match, return `{ envelope: existing, deduped: true }`. If found but content differs, throw `AppError('IDEMPOTENCY_CONFLICT', ...)`. Otherwise insert and return `{ envelope: new, deduped: false }`.
- `service.ingest` writes one audit event per call: `event_type = 'envelope.ingested'` (or `envelope.deduped`).

**Cross-module use.** `modules/envelope/index.js` exports `ingest`, `findByEnvelopeId`, `validateEnvelope`, the Joi schema, and the enum arrays. Adapters in B2.3+ use `ingest`.

**Exit checks:**
- `pnpm migrate` — applies `0005_envelopes.sql`
- `pnpm vitest run modules/envelope` — covers ingest happy path, dedupe with same content, conflict with different content, audit event written, FOR UPDATE concurrency (two concurrent inserts of same key — only one wins, the other dedups)
- Standalone server: `node modules/envelope/server.js &`, `curl -sf http://localhost:4101/health`, then POST a sample envelope, get back the persisted form.

---

## B2.3 — REST/JSON adapter

**Purpose.** Accept canonical envelopes directly from REST clients. Sign on egress. Verify on ingress (when the originator participant has a registered key — Phase 3 will populate; for now, signature verification is best-effort).

**Files to create.**
- `modules/adapters-rest/parser.js` — `parse(jsonBody) -> envelope` (this is essentially passthrough + validate)
- `modules/adapters-rest/formatter.js` — `format(envelope) -> json string` (passthrough + freeze)
- `modules/adapters-rest/controller.js` — `POST /rest/inbound` accepts JSON envelope, calls `envelope.ingest`, returns persisted envelope; `POST /rest/outbound` is the egress path that signs and emits
- `modules/adapters-rest/routes.js`
- `modules/adapters-rest/server.js` (port 4102)
- `modules/adapters-rest/index.js`
- `modules/adapters-rest/tests/rest.test.js`

**Notes.**
- BigInt amounts in JSON: documented contract is "amount.value is a string of digits". The parser accepts string, rejects Number.
- Egress signing: `format(envelope)` calls `cryptoKeys.sign({ kid: railKid, payload: canonicalJsonBytes(envelope) })` and attaches signature.

**Canonical JSON.** Define a small `canonicalJson(obj)` helper in `core/json.js` (this is a new core file — adding it is OK at phase boundary, **not** mid-block; do this as the first thing in B2.3 before writing the adapter): sorts keys recursively and serializes deterministically. Used for signing.

**Exit checks:**
- `pnpm vitest run modules/adapters-rest` — green; covers parse happy path, parse rejects malformed JSON, format produces valid envelope, sign+verify roundtrip uses canonical JSON.
- Standalone server health + one POST `/rest/inbound` round-trip via curl.

---

## B2.4 — ISO 20022 adapter

**Purpose.** Accept ISO 20022 XML messages, parse to envelope. Format envelopes as ISO 20022 XML for outbound legs.

**Versions to support (locked — these are current as of March 2026):**
- `pacs.008.001.14` — FIToFICustomerCreditTransfer (inbound credit transfer instruction)
- `pacs.002.001.16` — FIToFIPaymentStatusReport (status response)
- `pacs.004.001.15` — PaymentReturn (return / unwind)
- `pacs.007.001.14` — FIToFIPaymentReversal (reversal)
- `camt.056.001.11` — FIToFIPaymentCancellationRequest (recall)

**Mapping summary (pacs.008.001.14 → envelope):**

| ISO 20022 path | Envelope field |
|---|---|
| `Document/FIToFICstmrCdtTrf/GrpHdr/MsgId` | `sourceMessageId` |
| `Document/FIToFICstmrCdtTrf/CdtTrfTxInf/PmtId/EndToEndId` | `endToEndId` (if no UETR) |
| `Document/FIToFICstmrCdtTrf/CdtTrfTxInf/PmtId/UETR` | `endToEndId` (preferred) |
| `Document/FIToFICstmrCdtTrf/CdtTrfTxInf/IntrBkSttlmAmt` | `amount.value` (×10^minor units), `amount.currency` |
| `Dbtr/Nm` | `originator.name` |
| `DbtrAcct/Id/Othr/Id` or `DbtrAcct/Id/IBAN` | `originator.accountId` |
| `DbtrAgt/FinInstnId/BICFI` | `originator.bic` |
| `Cdtr/Nm` | `beneficiary.name` |
| `CdtrAcct/Id/...` | `beneficiary.accountId` |
| `CdtrAgt/FinInstnId/BICFI` | `beneficiary.bic` |
| `Purp/Cd` | `purposeCode` |
| `RmtInf/Ustrd[0]` | `remittance` |
| `RmtInf/Strd/RfrdDocInf/Nb` | `reference` |
| `IntrBkSttlmDt` | `settlementDate` |
| `SttlmInf/SttlmMtd` | `settlementMethod` |

**Files to create.**
- `modules/adapters-iso20022/xml.js` — XML parse/serialize using `fast-xml-parser` (add to `package.json` dependencies; bump in B2.4 since this is the first place we need it). Configure preserveOrder=false, ignoreAttributes=false, attributeNamePrefix='@'.
- `modules/adapters-iso20022/pacs008.parser.js` — `parsePacs008Xml(xml) -> envelope`
- `modules/adapters-iso20022/pacs008.formatter.js` — `formatPacs008Xml(envelope) -> xmlString`
- `modules/adapters-iso20022/pacs002.parser.js` / `.formatter.js`
- `modules/adapters-iso20022/pacs004.parser.js` / `.formatter.js`
- `modules/adapters-iso20022/pacs007.parser.js` / `.formatter.js`
- `modules/adapters-iso20022/camt056.parser.js` / `.formatter.js`
- `modules/adapters-iso20022/controller.js` — routes accept XML body, parse, ingest, return canonical envelope; egress route formats envelope to XML
- `modules/adapters-iso20022/routes.js` — uses `express.text({ type: 'application/xml' })` middleware on the inbound routes
- `modules/adapters-iso20022/server.js` (port 4103)
- `modules/adapters-iso20022/index.js`
- `modules/adapters-iso20022/tests/iso20022.test.js`
- `modules/adapters-iso20022/fixtures/pacs008.sample.xml` — a real (synthetic) pacs.008.001.14 sample for tests; commit it.
- Same for pacs.002, pacs.004, pacs.007, camt.056 fixtures.

**Money conversion note.** ISO 20022 amounts are decimal (e.g. `<IntrBkSttlmAmt Ccy="GHS">150.00</IntrBkSttlmAmt>`). On parse: convert to BigInt minor units using `core/money.js` with the currency's minor digit count from the ISO 4217 table. On format: divide back. Reject parse if the decimal exceeds the currency's minor units.

**Exit checks:**
- `pnpm vitest run modules/adapters-iso20022` — green; for each version, `parse(format(env))` produces an envelope `deepEqual` to the original (round-trip), and parsing the committed fixture produces the expected envelope.
- Standalone server: POST the pacs.008 fixture to `/iso20022/inbound` — get back canonical envelope. POST envelope to `/iso20022/outbound?type=pacs008` — get back valid pacs.008 XML.

---

## B2.5 — ISO 8583 adapter

**Purpose.** Accept ISO 8583 messages from legacy bank cores. Support 1987, 1993, 2003 variants. Parse bitmap, MTI, and the fields the rail uses.

**Approach.** Roll our own minimal bitmap parser. No third-party ISO 8583 library — keeps the dependency surface small and aligns with the stack philosophy. The parser is small (~300 lines) and well within scope.

**Files to create.**
- `modules/adapters-iso8583/codec.js` — bitmap encode/decode, BCD/EBCDIC/ASCII variants. Functions: `encode8583(parsed)`, `decode8583(buffer)`, where `parsed = { mti, fields: { '2': '...', '3': '...', ... } }`.
- `modules/adapters-iso8583/specs/1987.js` — field spec table (length/type per DE for 1987)
- `modules/adapters-iso8583/specs/1993.js`
- `modules/adapters-iso8583/specs/2003.js`
- `modules/adapters-iso8583/parser.js` — `parse8583(buffer, version) -> envelope`
- `modules/adapters-iso8583/formatter.js` — `format8583(envelope, version, mti) -> buffer`
- `modules/adapters-iso8583/controller.js` — accepts raw binary body (`express.raw({ type: 'application/octet-stream', limit: '1mb' })`), parses, ingests; egress route formats
- `modules/adapters-iso8583/routes.js`
- `modules/adapters-iso8583/server.js` (port 4104)
- `modules/adapters-iso8583/index.js`
- `modules/adapters-iso8583/tests/iso8583.test.js`
- `modules/adapters-iso8583/fixtures/0200.1987.bin` — sample financial transaction request. Generate fixtures as part of the test setup.

**Field mapping for an 0200/0210 financial transaction (the only MTIs Phase 2 supports — 0100/0110 reserved for later):**

| DE | Meaning | Envelope field |
|---|---|---|
| 0 | MTI | drives `msgType` (0200 → CRDT_TRF; 0210 → response) |
| 2 | PAN / account number | `originator.accountId` for 0200 |
| 3 | Processing code | drives transaction type validation |
| 4 | Amount, transaction | `amount.value` (already minor units in 8583) |
| 7 | Transmission date/time | optional; not stored |
| 11 | STAN | `sourceMessageId` |
| 12 | Local time | (combined with DE13) |
| 13 | Local date | (combined with DE12) |
| 32 | Acquiring institution code | `originator.participantCode` |
| 37 | Retrieval ref | `endToEndId` |
| 41 | Card acceptor terminal ID | metadata |
| 42 | Card acceptor ID | metadata |
| 43 | Card acceptor name/location | `originator.name` if present |
| 49 | Currency code (numeric) | `amount.currency` (convert ISO 4217 numeric → alpha) |
| 100 | Receiving institution code | `beneficiary.participantCode` |
| 102 | Account ID 1 | `originator.accountId` (alt) |
| 103 | Account ID 2 | `beneficiary.accountId` |

Idempotency for 8583: `idempotencyKey = STAN(11) + TransmissionDateTime(7) + AcquiringInstId(32)`. Set this in the parser when not supplied externally.

**Exit checks:**
- `pnpm vitest run modules/adapters-iso8583` — green; round-trip for 1987/1993/2003 of an 0200; bitmap correctness; field length encodings (LLVAR, LLLVAR, fixed); all three character set variants.
- Standalone server: POST a binary 0200 fixture, get canonical envelope back.

---

## B2.6 — SWIFT MT adapter

**Purpose.** Accept legacy SWIFT MT messages. After the November 2025 SWIFT migration, MT for cross-border has been retired, but MT103 / MT202 remain in use for some corridors and for translation hubs. The rail must accept both during the long tail.

**Versions:**
- MT103 — Single Customer Credit Transfer
- MT202 — General Financial Institution Transfer
- MT202COV — Cover for MT103
- MT900/MT910 — debit/credit notifications (parse only; formatting deferred)

**Files to create.**
- `modules/adapters-swift/parser.js` — minimal MT block parser (Block 1 basic header, Block 2 application header, Block 4 text block with field tags, Block 5 trailers). Field-tag regex: `:NN[A-Z]?:`.
- `modules/adapters-swift/mt103.js` — `parseMT103(text) -> envelope`, `formatMT103(envelope) -> text`
- `modules/adapters-swift/mt202.js` — same
- `modules/adapters-swift/mt900-910.js` — parser only
- `modules/adapters-swift/controller.js` — accepts text body
- `modules/adapters-swift/routes.js`
- `modules/adapters-swift/server.js` (port 4105)
- `modules/adapters-swift/index.js`
- `modules/adapters-swift/tests/swift.test.js`
- `modules/adapters-swift/fixtures/mt103.sample.txt`, `mt202.sample.txt`

**Field mapping for MT103 (the important ones):**

| Field | Envelope field |
|---|---|
| 20 | `sourceMessageId` |
| 23B | bank-op code (`CRED` etc.) — drives `msgType` |
| 32A | settlement date + currency + amount → `settlementDate`, `amount.currency`, `amount.value` |
| 33B | original currency/amount — metadata |
| 50K / 50A | originator name/account |
| 52A | originator agent BIC |
| 57A | beneficiary's bank BIC |
| 59 / 59A | beneficiary name/account |
| 70 | remittance |
| 71A | charges bearer (BEN/OUR/SHA) → `fee.bearer` |
| 72 | sender to receiver info — metadata |

**Exit checks:**
- `pnpm vitest run modules/adapters-swift` — green; round-trip MT103 and MT202.
- Standalone server: POST MT103 fixture, get canonical envelope.

---

## B2.7 — Bulk file adapter

**Purpose.** Ingest bulk payment files. Three formats: CSV (custom column spec), XLSX (same columns), pain.001 (ISO 20022 customer credit transfer initiation, the file-level standard for batches). Each line/transaction becomes one envelope.

**Approach.** Streaming where possible (CSV via `csv-parse/sync` is acceptable for files <100MB; XLSX via `xlsx` library; pain.001 via fast-xml-parser like B2.4). Add `csv-parse` and `xlsx` to dependencies in this block.

**Files to create.**
- `modules/adapters-bulk/csv.js` — `parseCsv(buffer) -> envelope[]`, with strict column header check
- `modules/adapters-bulk/xlsx.js` — same shape
- `modules/adapters-bulk/pain001.js` — `parsePain001(xml) -> envelope[]` (pain.001.001.12 is the current version per ISO 20022)
- `modules/adapters-bulk/service.js` — `ingestBatch(envelopes, batchMeta)` opens a transaction, ingests envelopes one at a time, returns `{ batchId, total, succeeded, failed: [{ line, error }] }`. Per-line failures don't abort the batch; they're collected.
- `migrations/0006_bulk_batches.sql` — `bulk_batches` table (batch_id, source_format, originator_participant, total, succeeded, failed, status, created_at, completed_at)
- `modules/adapters-bulk/controller.js` — `POST /bulk/csv`, `/bulk/xlsx`, `/bulk/pain001` accept multipart upload via `express-fileupload`
- `modules/adapters-bulk/routes.js`
- `modules/adapters-bulk/server.js` (port 4106)
- `modules/adapters-bulk/index.js`
- `modules/adapters-bulk/tests/bulk.test.js`
- `modules/adapters-bulk/fixtures/payroll.10rows.csv`, `payroll.10rows.xlsx`, `pain001.5tx.xml`

**Required CSV header (exact, in order):**

```
originator_participant,originator_account,originator_name,beneficiary_participant,beneficiary_account,beneficiary_name,amount_minor,currency,reference,remittance,end_to_end_id
```

Idempotency: each line's `idempotencyKey` is auto-derived as `${batchId}:${rowIndex}` if not provided.

**Exit checks:**
- `pnpm vitest run modules/adapters-bulk` — green; 10-row CSV → 10 envelopes ingested; one bad row → 9 succeeded, 1 failed reported; XLSX same; pain.001 with 5 transactions → 5 envelopes.
- Standalone server: upload the CSV fixture, get back batch summary; verify rows are in `envelopes` table.

---

## B2.8 — Phase 2 exit gate: round-trip suite + demo script

**Purpose.** Lock the phase. A single demo script runs every adapter end-to-end against a live monolith and proves the canonical envelope is the same regardless of input format.

**Files to create.**
- `scripts/demo-phase-2.sh`
- `tests/phase-2-roundtrip.test.js` — top-level integration test: for each format, build an envelope, format to wire format, parse back, assert equality.

**`scripts/demo-phase-2.sh`** outline:

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
for i in $(seq 1 30); do curl -sf http://localhost:3000/health > /dev/null && break; sleep 0.2; done

# Auth
curl -sf -c /tmp/sika-cookie -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@sika.local","password":"admin1234"}'

# REST adapter
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/adapters-rest/inbound \
  -H 'content-type: application/json' \
  -d @modules/adapters-rest/fixtures/sample.envelope.json | tee /tmp/rest.out
test "$(jq -r '.ok' /tmp/rest.out)" = "true"

# ISO 20022 adapter
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/adapters-iso20022/inbound/pacs008 \
  -H 'content-type: application/xml' \
  --data-binary @modules/adapters-iso20022/fixtures/pacs008.sample.xml | tee /tmp/iso.out
test "$(jq -r '.ok' /tmp/iso.out)" = "true"

# ISO 8583 adapter
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/adapters-iso8583/inbound \
  -H 'content-type: application/octet-stream' \
  --data-binary @modules/adapters-iso8583/fixtures/0200.1987.bin | tee /tmp/8583.out
test "$(jq -r '.ok' /tmp/8583.out)" = "true"

# SWIFT MT adapter
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/adapters-swift/inbound/mt103 \
  -H 'content-type: text/plain' \
  --data-binary @modules/adapters-swift/fixtures/mt103.sample.txt | tee /tmp/mt.out
test "$(jq -r '.ok' /tmp/mt.out)" = "true"

# Bulk adapter
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/adapters-bulk/csv \
  -F file=@modules/adapters-bulk/fixtures/payroll.10rows.csv | tee /tmp/bulk.out
test "$(jq -r '.data.succeeded' /tmp/bulk.out)" = "10"

# Idempotency proof: re-post the REST envelope, expect deduped=true
curl -sf -b /tmp/sika-cookie -X POST http://localhost:3000/adapters-rest/inbound \
  -H 'content-type: application/json' \
  -d @modules/adapters-rest/fixtures/sample.envelope.json | tee /tmp/rest.dup.out
test "$(jq -r '.data.deduped' /tmp/rest.dup.out)" = "true"

kill $SERVER_PID
wait $SERVER_PID 2>/dev/null || true
echo "PHASE 2 OK"
```

**Phase 2 exit gate (paste output):**
- `bash scripts/demo-phase-2.sh` — prints `PHASE 2 OK`
- `pnpm vitest run` — full suite green (Phase 1 + Phase 2 tests, expect ~250+ tests total)
- `pnpm reset && pnpm migrate && pnpm seed` — clean from empty DB, all 6 migrations apply
- `pnpm check-boundaries` — clean
- `git log --oneline | head -20` — shows ≥10 phase-1 commits + 8 phase-2 commits

When this passes, Phase 2 is done. Stop. Wait for "continue to Phase 3."

---

## What "PHASE 2 OK" unlocks

After Phase 2 ships:
- The rail accepts payments in **any format** any participant can produce. ISO 8583 banks, ISO 20022 banks, fintechs on REST, bulk file payroll runs, SWIFT MT cross-border legs — all become canonical envelopes.
- Idempotency works at the wire layer regardless of format.
- Every later phase reads only canonical envelopes. No format-specific code escapes `modules/adapters-*/`.
- The pattern is set: a new format added later (e.g. NACHA, BACS, RTP) is one new adapter module following the same shape — no changes to anything else.
