# PHASE 9 — Cross-Border Native

**Mode:** Autonomous. Single master prompt, no per-block sign-off.

**Goal at end of phase:**
- The rail handles cross-border payments natively, the way Meridian does, without correspondent banks.
- A Ghanaian sending GHS to a Nigerian receiving NGN goes through the rail, the rail's FX engine, a foreign rail (NIBSS via PAPSS), and back — atomically.
- Foreign rails register as a special class of participant (`type = 'FOREIGN_RAIL'`).
- FX engine quotes rates locked at authorization with a defined slippage window.
- Atomic two-leg cross-border via PvP (Payment-versus-Payment) coordinator pattern — both legs commit or neither does.
- FATF travel rule enforced: originator and beneficiary identifying info travels with cross-border payments.
- Cross-border-specific dispute reason codes added to Phase 7's locked taxonomy.
- CBDC and stablecoin can serve as cross-border settlement assets via a pluggable settlement-asset interface.

**Why this phase matters.** Phase 9 takes the domestic rail and makes it a regional hub. Ghana is in the West African Monetary Zone, and PAPSS interlinking is a real opportunity. The foreign-rail registry pattern from Phase 9 also lays the groundwork for BIS Project Nexus (multilateral instant cross-border) in the future.

---

## What's in scope, what isn't

**In scope (Phase 9):**
- Foreign rail registry (PAPSS, NIBSS, PesaLink, TIPS, BIS Nexus as registered foreign rails)
- Multi-currency FX engine (quote, lock, settle, slippage protection)
- Atomic two-leg cross-border via PvP coordinator
- Travel rule enforcement (originator + beneficiary identifying info)
- Cross-border message envelope extensions (currency, FX, country codes, travel rule fields)
- Cross-border-specific dispute reason codes
- Foreign rail simulator (the way Phase 4 has a participant simulator) — proves the contract without needing real PAPSS connectivity in dev/test
- CBDC/stablecoin pluggable settlement-asset interface (fake adapter for both — real adapters slot in later)

**NOT in scope (deferred):**
- Real PAPSS production integration — requires BoG accreditation
- Real BIS Nexus integration — system isn't fully launched yet
- Real CBDC integration (e-Cedi has been in pilot since Sept 2022, full deployment not finalized)
- Real stablecoin integration (regulatory clarity required first)
- SWIFT gpi tracking — would require live SWIFT BIC + commercial relationship
- Pre-funding/treasury optimization across multiple foreign currencies

---

## Architectural shape

```
                Domestic participant         Foreign rail (e.g. PAPSS)
                       │                              │
                       ▼                              ▼
                ┌──────────────────────────────────────────┐
                │     crossborder-tx (PvP coordinator)      │
                │   ┌──────────────┐  ┌──────────────────┐ │
                │   │  leg 1:      │  │   leg 2:         │ │
                │   │  participant │  │   rail nostro →  │ │
                │   │  → rail FX   │  │   foreign rail   │ │
                │   │  nostro      │  │   participant    │ │
                │   └──────────────┘  └──────────────────┘ │
                └──────────────────┬───────────────────────┘
                                   │
                ┌──────────────────┴─────────────────────┐
                │                                          │
                ▼                                          ▼
       ┌────────────────┐                       ┌──────────────────┐
       │ crossborder-fx │                       │ crossborder-rails │
       │ (quote, lock)  │                       │ (foreign rail     │
       └────────────────┘                       │  registry +       │
                                                │  simulator)       │
                                                └──────────────────┘

       ┌──────────────────────┐         ┌────────────────────────┐
       │ crossborder-travel-  │         │ settlement-assets       │
       │ rule (FATF)          │         │ (CBDC/stablecoin        │
       └──────────────────────┘         │  pluggable adapters)    │
                                        └────────────────────────┘
```

---

## Locked: cross-border architecture facts

These are the architectural commitments. CC must not invent more.

| Fact | Value |
|---|---|
| Foreign rails are participants of `type = 'FOREIGN_RAIL'` | Already supported by Phase 3's enum, no schema change |
| FX rate is quoted, then **locked** at authorization with a 60-second validity window | Locked rate is part of the envelope's signature surface |
| Slippage protection: customer accepts at quoted rate or rejects | Mid-flight rate change does not silently update |
| Atomic two-leg via PvP coordinator | Both legs commit in same `withTransaction`. Failure of either rolls back both. |
| Travel rule data is part of the envelope | Cannot be redacted post-creation |
| New ledger account types for cross-border nostros | `RAIL_FX_NOSTRO` (per currency), `RAIL_FOREIGN_RAIL_NOSTRO` (per foreign rail per currency) |
| Multi-currency money math | Already supported by Phase 1 `core/money.js`; ISO 4217 minor digits used per currency |
| Cross-border response code mapping | Same as Phase 4 ISO 20022 codes; adds `XB02` for "Cross-border counterparty unreachable" |

---

## Locked: cross-border envelope extension

All standard envelope fields apply, plus:

```js
{
  // existing envelope fields...
  msgType: 'XB_CRDT_TRF',                     // new msgType for cross-border credit transfer
  
  // Cross-border specifics
  crossBorder: {
    foreignRailCode: 'PAPSS',                  // registered in foreign-rail-registry
    originatorCountry: 'GH',                   // ISO 3166-1 alpha-2
    beneficiaryCountry: 'NG',
    
    fx: {
      payCurrency: 'GHS',                      // what originator pays in
      receiveCurrency: 'NGN',                  // what beneficiary receives in
      lockedRate: '15.42',                     // pay = receive / rate, rate is decimal string
      lockedAt: '2026-04-26T12:34:56.789Z',
      lockExpiresAt: '2026-04-26T12:35:56.789Z', // 60 seconds default
      quoteId: 'uuid',                         // reference to fx_quotes row
      payAmount: '100000',                     // BigInt minor units in pay currency
      receiveAmount: '6492220'                 // BigInt minor units in receive currency
    },
    
    travelRule: {
      originatorIdType: 'GHANACARD' | 'PASSPORT' | 'NATIONAL_ID' | 'CORPORATE_REG',
      originatorIdValue: 'GHA-...',            // hashed/salted; never plain
      originatorIdHashed: 'sha256:...',
      originatorAddress: '...',
      originatorDateOfBirth: 'YYYY-MM-DD',
      beneficiaryIdType: '...',
      beneficiaryIdHashed: 'sha256:...',
      beneficiaryAddress: '...',
      beneficiaryDateOfBirth: 'YYYY-MM-DD',
      purposeOfPayment: 'TRADE_GOODS' | 'TRADE_SERVICES' | 'REMITTANCE_FAMILY' | 'EDUCATION' | 'MEDICAL' | 'INVESTMENT' | 'OTHER',
      jurisdictionOfOriginator: 'GH',
      jurisdictionOfBeneficiary: 'NG'
    },
    
    settlementAssetType: 'LOCAL_CURRENCY_NET' | 'CBDC' | 'STABLECOIN'
  }
}
```

The travel rule fields are required for any `XB_CRDT_TRF` envelope. Missing fields → reject at envelope ingestion.

---

## B9.1 — Foreign rail registry + simulator

**Purpose.** The foreign-rail registry is a specialized view of `participants` where `type = 'FOREIGN_RAIL'`. Each foreign rail has registered endpoints, supported currencies, and a configured settlement model. The simulator is the dev/test stand-in — implements the same HTTP contract a real PAPSS adapter would.

**Files to create.**
- `migrations/0044_foreign_rails.sql`
- `modules/crossborder-rails/codes.js`
- `modules/crossborder-rails/schema.js`
- `modules/crossborder-rails/model.js`
- `modules/crossborder-rails/service.js`
- `modules/crossborder-rails/simulator.js`
- `modules/crossborder-rails/controller.js`
- `modules/crossborder-rails/routes.js`
- `modules/crossborder-rails/server.js` (port 4801, key `crossborderRailsPort`)
- `modules/crossborder-rails/index.js`
- `modules/crossborder-rails/tests/rails.test.js`

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS foreign_rails (
  id                       UUID PRIMARY KEY,
  rail_code                TEXT UNIQUE NOT NULL,        -- 'PAPSS', 'NIBSS', 'PESALINK', 'TIPS', 'BIS_NEXUS'
  rail_name                TEXT NOT NULL,
  rail_type                TEXT NOT NULL,                -- 'MULTILATERAL_HUB' | 'BILATERAL'
  participant_id           UUID NOT NULL REFERENCES participants(id),
  supported_currencies     TEXT[] NOT NULL,
  supported_countries      TEXT[] NOT NULL,
  settlement_model         TEXT NOT NULL,                -- 'NET_DAILY' | 'GROSS_INSTANT' | 'CBDC' | 'STABLECOIN'
  cutover_time_utc         TIME,                          -- e.g. '11:00:00' for PAPSS daily settlement
  endpoints                JSONB NOT NULL,                -- { quote, instruct, status, freeze, reverse }
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  active                   BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS foreign_rails_active_idx ON foreign_rails(active);
CREATE INDEX IF NOT EXISTS foreign_rails_country_idx ON foreign_rails USING gin(supported_countries);
```

**Foreign rail HTTP contract** (the simulator implements this; real adapters slot into the same shape):

- `POST {endpoints.quote}` — body `{payCurrency, receiveCurrency, payAmount}` → returns `{quoteId, lockedRate, lockExpiresAt, receiveAmount, fees}`
- `POST {endpoints.instruct}` — body `{quoteId, originator, beneficiary, travelRule}` → returns `{foreignTxId, status: 'ACCEPTED' | 'REJECTED', reasonCode}` synchronously, then async confirmation via callback or poll
- `POST {endpoints.status}` — body `{foreignTxId}` → returns `{status, settledAt, beneficiaryRef}`
- `POST {endpoints.freeze}` — for fast-track reversal across border
- `POST {endpoints.reverse}` — for reversal flow

**Simulator behavior** (similar to Phase 4 force-account taxonomy):
- Test currency pair `GHS→NGN` always quotes rate `15.42`
- Test currency pair `GHS→KES` always quotes `12.85`
- Test currency pair `GHS→USD` always quotes `0.083`
- Test beneficiary account `9999100001` always succeeds
- `9999100002` returns `RJCT/AC04` (closed)
- `9999100007` times out
- `9999100009` settles asynchronously (returns ACCEPTED, calls back after 5s)

**Seed extension:** `scripts/seed.js` adds 3 demo foreign rails (`PAPSS_FAKE`, `NIBSS_FAKE`, `BIS_NEXUS_FAKE`), each pointing to the simulator at the appropriate port path.

**Routes:**
- `GET /crossborder-rails` — list
- `POST /crossborder-rails` — register (admin)
- `GET /crossborder-rails/:code` — fetch
- `GET /crossborder-rails/find?country=NG&currency=NGN` — find rails that can settle a given country+currency

Plus the simulator's own routes mounted under `/simulator-foreign/:railCode/...`.

**Exit checks:** standard. Tests:
- Register foreign rail with valid endpoint set → succeeds
- Register without supported currencies → rejected
- find() returns rails that can settle the requested currency
- Simulator quote → instruct → status round-trip
- Simulator force-fail accounts produce expected errors

---

## B9.2 — FX engine

**Purpose.** Quote, lock, and settle FX rates. Rate quotes come from market makers (or the simulator). Locked rates are part of the envelope signature, so they cannot be silently changed mid-flight. Slippage protection rejects rates that move beyond a configured threshold while the customer is confirming.

**Files to create.**
- `migrations/0045_fx_quotes.sql`
- `migrations/0046_fx_market_makers.sql`
- `modules/crossborder-fx/codes.js`
- `modules/crossborder-fx/schema.js`
- `modules/crossborder-fx/model.js`
- `modules/crossborder-fx/quote-service.js`
- `modules/crossborder-fx/maker-client.js`             — pluggable interface
- `modules/crossborder-fx/maker-fake.js`
- `modules/crossborder-fx/controller.js`
- `modules/crossborder-fx/routes.js`
- `modules/crossborder-fx/server.js` (port 4802)
- `modules/crossborder-fx/index.js`
- `modules/crossborder-fx/tests/fx.test.js`

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS fx_market_makers (
  id                  UUID PRIMARY KEY,
  maker_code          TEXT UNIQUE NOT NULL,            -- 'AFREXIM', 'BOG_RESERVE', 'COMMERCIAL_DESK_1'
  maker_name          TEXT NOT NULL,
  supported_pairs     TEXT[] NOT NULL,                  -- ['GHS/NGN', 'GHS/KES', ...]
  endpoints           JSONB NOT NULL,
  priority            INT NOT NULL DEFAULT 100,         -- lower = preferred
  active              BOOLEAN NOT NULL DEFAULT true,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS fx_quotes (
  id                  UUID PRIMARY KEY,
  pay_currency        CHAR(3) NOT NULL,
  receive_currency    CHAR(3) NOT NULL,
  pay_amount_minor    NUMERIC(38,0) NOT NULL,
  receive_amount_minor NUMERIC(38,0) NOT NULL,
  rate_decimal_str    TEXT NOT NULL,                    -- the rate as a string (decimal precision varies)
  market_maker_id     UUID NOT NULL REFERENCES fx_market_makers(id),
  fee_pay_minor       NUMERIC(38,0) NOT NULL DEFAULT 0,
  fee_receive_minor   NUMERIC(38,0) NOT NULL DEFAULT 0,
  state               TEXT NOT NULL DEFAULT 'OPEN',     -- 'OPEN' | 'LOCKED' | 'CONSUMED' | 'EXPIRED' | 'REJECTED_SLIPPAGE'
  quoted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  consumed_transaction_id UUID REFERENCES transactions(id),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS fx_quotes_active_idx ON fx_quotes(state) WHERE state IN ('OPEN', 'LOCKED');
CREATE INDEX IF NOT EXISTS fx_quotes_pair_idx ON fx_quotes(pay_currency, receive_currency, quoted_at DESC);
```

**Service API:**

```js
quote({ payCurrency, receiveCurrency, payAmount }) -> { quoteId, rate, receiveAmount, lockExpiresAt }
lock(quoteId) -> { quoteId, locked: true }
verifyLockNotExpired(quoteId) -> boolean
consumeOnTransaction(client, quoteId, transactionId)
expirePastDue() -> count
```

**Quote algorithm:**
1. Find the highest-priority active market maker supporting the pair.
2. Call `maker-client.quote(pair, amount)` — returns rate + fees.
3. Compute receive amount: `(payAmount - feePayMinor) * rate`, applying ISO 4217 minor-digit conversion between currencies.
4. Insert quote row, default `expires_at = now() + 60 seconds`.
5. Return.

**Slippage protection.** When the customer confirms (lock + transaction), the engine re-checks the current market rate. If the current rate has moved more than `config.fxSlippageBps` (default 50 basis points = 0.5%) from the locked rate, reject with `SLIPPAGE_EXCEEDED`. Customer must re-quote.

**Money math correctness.** Cross-currency conversion:

```js
// pay 100.00 GHS at rate 15.42 to NGN:
// payMinor = 10000n (GHS minor units, 2 decimals)
// rate = 15.42 (decimal string)
// receiveMinorBigInt = (payMinor * rateMantissa) * 10^(receiveMinorDigits - payMinorDigits) / rateScale
```

Implement this in `core/money.js` extension (authorized addition to core for B9.2): `convertMinor({ payMinor, payCurrency, receiveCurrency, rate })` returns BigInt receive minor units. Round half-down (favor the rail conservatively).

**Routes:**
- `POST /fx/quote` — body `{payCurrency, receiveCurrency, payAmount}` → returns quote
- `GET /fx/quotes/:id` — fetch
- `POST /fx/quotes/:id/lock` — explicit lock (optional; lock happens implicitly at transaction)

**Exit checks:** standard. Tests:
- Quote happy path: GHS→NGN at 15.42 with 100 GHS pay → 6492220 NGN minor
- Quote with multiple market makers: highest-priority maker wins
- Lock + consume on transaction: state transitions correctly
- Expiration past due: state transitions to EXPIRED
- Slippage protection: rate moves >50bps → rejected
- Cross-currency math correctness across all minor-digit combinations (GHS=2, JPY=0, etc.)

---

## B9.3 — Cross-border envelope extension

**Purpose.** Extend the envelope schema to support `XB_CRDT_TRF` and the `crossBorder` field. Validate that all required cross-border fields are present at envelope ingestion.

**Files to create.**
- `modules/envelope/schema-crossborder.js` — extension to the envelope schema
- (extends `modules/envelope/factory.js` and `modules/envelope/validators.js`)
- `modules/envelope/tests/crossborder-envelope.test.js`

No new migration. The existing `envelopes.envelope` JSONB column already stores the full envelope; the new fields are part of the JSON, validated at ingestion.

**Schema additions:**
- New `msgType`: `XB_CRDT_TRF`
- New `crossBorder` object (required when msgType is XB_CRDT_TRF) with the locked shape from the top of this doc
- All travel-rule fields required

**Validation:**
- `crossBorder.fx.payAmount` and `crossBorder.fx.receiveAmount` are BigInt strings, just like top-level `amount.value`
- `crossBorder.fx.lockedRate` is a decimal string (matches `^\d+(\.\d+)?$`)
- `crossBorder.fx.lockExpiresAt` must be in the future at envelope ingestion
- `crossBorder.travelRule.originatorIdType` and `beneficiaryIdType` are from a locked enum
- Country codes are valid ISO 3166-1 alpha-2

**Exit checks:** standard. Tests:
- Valid XB_CRDT_TRF envelope ingests
- Missing `crossBorder` field → rejected
- Missing travel rule field → rejected
- `lockExpiresAt` in the past → rejected (envelope ingestion happens within the lock window)
- Invalid country code → rejected
- Phase 4 retroactive: existing CRDT_TRF envelopes still ingest fine

---

## B9.4 — Atomic cross-border transaction (PvP coordinator)

**Purpose.** The actual two-leg cross-border payment. Both legs (debit originator's participant settlement to rail FX nostro; credit foreign rail nostro from rail FX nostro) commit together via the PvP pattern. The `transactions/orchestrator` is extended to handle `XB_CRDT_TRF` by routing to the cross-border coordinator, which itself orchestrates the two legs in a single `withTransaction` plus a foreign rail confirmation step.

**Files to create.**
- `migrations/0047_crossborder_transactions.sql`
- `modules/crossborder-tx/codes.js`
- `modules/crossborder-tx/states.js`
- `modules/crossborder-tx/schema.js`
- `modules/crossborder-tx/model.js`
- `modules/crossborder-tx/coordinator.js`              — the PvP coordinator
- `modules/crossborder-tx/leg-runner.js`               — runs each leg
- `modules/crossborder-tx/foreign-rail-client.js`     — calls foreign rail's instruct endpoint
- `modules/crossborder-tx/recovery-worker.js`         — recovery for ambiguous foreign-rail outcomes
- `modules/crossborder-tx/controller.js`
- `modules/crossborder-tx/routes.js`
- `modules/crossborder-tx/server.js` (port 4803)
- `modules/crossborder-tx/index.js`
- `modules/crossborder-tx/tests/crossborder-tx.test.js`
- **Patch:** `modules/transactions/orchestrator.js` — when envelope is `XB_CRDT_TRF`, delegate to `crossborder-tx/coordinator.js` instead of running the standard credit-leg.
- **Patch:** `modules/ledger/codes.js` — add `RAIL_FX_NOSTRO` and `RAIL_FOREIGN_RAIL_NOSTRO` account types.

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS crossborder_transactions (
  id                       UUID PRIMARY KEY,
  transaction_id           UUID UNIQUE NOT NULL REFERENCES transactions(id),
  foreign_rail_code        TEXT NOT NULL REFERENCES foreign_rails(rail_code),
  foreign_tx_id            TEXT,                              -- the foreign rail's reference
  fx_quote_id              UUID NOT NULL REFERENCES fx_quotes(id),
  pay_currency             CHAR(3) NOT NULL,
  receive_currency         CHAR(3) NOT NULL,
  pay_amount_minor         NUMERIC(38,0) NOT NULL,
  receive_amount_minor     NUMERIC(38,0) NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'INITIATED', -- 'INITIATED' | 'LEG_1_COMMITTED' | 'FOREIGN_INSTRUCTING' | 'FOREIGN_ACCEPTED' | 'CONFIRMED' | 'REJECTED' | 'PENDING_FOREIGN' | 'FAILED'
  leg_1_journal_id         UUID REFERENCES ledger_journal(id),
  leg_2_journal_id         UUID REFERENCES ledger_journal(id),
  travel_rule_payload      JSONB NOT NULL,
  settlement_asset_type    TEXT NOT NULL DEFAULT 'LOCAL_CURRENCY_NET',
  initiated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  foreign_response_at      TIMESTAMPTZ,
  confirmed_at             TIMESTAMPTZ,
  rejected_at              TIMESTAMPTZ,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS xb_tx_state_idx ON crossborder_transactions(state);
CREATE INDEX IF NOT EXISTS xb_tx_foreign_rail_idx ON crossborder_transactions(foreign_rail_code);
CREATE INDEX IF NOT EXISTS xb_tx_pending_foreign_idx ON crossborder_transactions(state) WHERE state IN ('FOREIGN_INSTRUCTING', 'PENDING_FOREIGN');
```

**Coordinator algorithm (PvP):**

```js
async coordinate(envelope, parentTransaction) {
  return withTransaction(async (client) => {
    // Pre-flight checks (in parent txn)
    const quote = await fxService.findQuote(envelope.crossBorder.fx.quoteId);
    if (quote.state !== 'OPEN' && quote.state !== 'LOCKED') throw new AppError('FX_QUOTE_INVALID', ...);
    if (quote.expiresAt < now()) throw new AppError('FX_QUOTE_EXPIRED', ...);
    
    // Lock the quote
    await fxService.consumeOnTransaction(client, quote.id, parentTransaction.id);
    
    // Travel rule enforcement — re-check sanctions on both originator and beneficiary
    await travelRuleService.enforce(client, envelope);
    
    // LEG 1: participant settlement → rail FX nostro
    // (direct ledger post — rail-internal account on receive side, per overlay rule refinement)
    const leg1 = await ledgerService.postJournal(client, {
      reason: 'XB_LEG_1',
      referenceType: 'crossborder_tx', referenceId: parentTransaction.id,
      operatingDate: today(),
      entries: [
        { accountCode: psetAccount(envelope.originator), side: 'DR', amount: payAmountMinor, currency: payCurrency },
        { accountCode: railFxNostro(payCurrency), side: 'CR', amount: payAmountMinor, currency: payCurrency }
      ]
    });
    
    // LEG 2: rail FX nostro → foreign rail nostro (already converted)
    const leg2 = await ledgerService.postJournal(client, {
      reason: 'XB_LEG_2',
      referenceType: 'crossborder_tx', referenceId: parentTransaction.id,
      operatingDate: today(),
      entries: [
        { accountCode: railFxNostro(receiveCurrency), side: 'DR', amount: receiveAmountMinor, currency: receiveCurrency },
        { accountCode: foreignRailNostro(foreignRailCode, receiveCurrency), side: 'CR', amount: receiveAmountMinor, currency: receiveCurrency }
      ]
    });
    
    // Note: leg 1 and leg 2 are in different currencies. The rail's FX nostro
    // accounts naturally have positions in both currencies; the FX risk lives
    // here and is settled with market makers separately (Phase 11+).
    
    // Persist the crossborder_transactions row in INITIATED state
    await xbtxModel.insert(client, { transactionId, fxQuoteId, leg1JournalId, leg2JournalId, ...});
    
    // Both ledger legs committed in this transaction.
    // Now the foreign rail call — but we DO NOT block on it inside the transaction.
    // Transition to FOREIGN_INSTRUCTING and audit. Background flow handles the rest.
    return { transactionId, state: 'FOREIGN_INSTRUCTING' };
  });
  
  // After transaction commits, async call to foreign rail
  // (this is OUTSIDE the withTransaction)
  // We use a worker pattern here, not blocking the request
}
```

**Foreign rail leg.** The foreign rail call happens after the local ledger commits. The `recovery-worker.js` picks up `FOREIGN_INSTRUCTING` rows and calls the foreign rail's `instruct` endpoint. On `ACCEPTED`, transitions to `CONFIRMED` and updates `transactions.state` to `CONFIRMED`. On `REJECTED`, transitions to `REJECTED`, posts the inverse local ledger journals (compensating leg-1 and leg-2 reversals), updates `transactions.state` to `REJECTED`. On timeout, `PENDING_FOREIGN` and the recovery worker retries with the same exponential backoff as Phase 4 recovery.

**Why ledger commits before foreign rail call:** the rail commits to its own books first. If the foreign rail rejects, the rail compensates with reversal journals. This is the standard PvP pattern — the rail's atomicity is in its own books; the foreign rail's atomicity is in theirs; the coordinator handles the diff.

**Recovery for foreign-rail timeouts.** Same as Phase 4: status-check, retry, eventually `FAILED` if still ambiguous. For confirmed-fraud cross-border, fast-track reversal extends to call the foreign rail's `freeze` endpoint.

**Routes:**
- `POST /crossborder-tx/quote-and-instruct` — convenience: quote + instruct in one call (most participant integrations use this)
- `GET /crossborder-tx/:id` — fetch
- `GET /crossborder-tx/by-tx/:txId` — fetch by parent transaction id

**Exit checks:** standard. Tests:
- Quote → ingest XB envelope → orchestrator routes to coordinator → both ledger legs commit → foreign rail accepts → CONFIRMED
- Foreign rail rejects → both ledger legs compensate → REJECTED
- Foreign rail times out → recovery worker confirms via status-check → CONFIRMED
- Foreign rail times out → recovery exhausts → FAILED + reversal_needed audit
- FX quote expired between quote and instruct → rejected
- Slippage exceeded → rejected
- ledger journals balance per currency

---

## B9.5 — Travel rule enforcement

**Purpose.** FATF requires originator and beneficiary identifying information to flow with cross-border payments. The travel rule module enforces this at envelope ingestion and on the inbound side when receiving from a foreign rail. Combined with the existing sanctions screening (Phase 6), this provides regulator-grade cross-border AML.

**Files to create.**
- `migrations/0048_travel_rule_records.sql`
- `modules/crossborder-travel-rule/codes.js`
- `modules/crossborder-travel-rule/schema.js`
- `modules/crossborder-travel-rule/model.js`
- `modules/crossborder-travel-rule/service.js`
- `modules/crossborder-travel-rule/controller.js`
- `modules/crossborder-travel-rule/routes.js`
- `modules/crossborder-travel-rule/server.js` (port 4804)
- `modules/crossborder-travel-rule/index.js`
- `modules/crossborder-travel-rule/tests/travel-rule.test.js`

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS travel_rule_records (
  id                       UUID PRIMARY KEY,
  crossborder_tx_id        UUID NOT NULL REFERENCES crossborder_transactions(id),
  direction                TEXT NOT NULL,                    -- 'OUTBOUND' | 'INBOUND'
  originator_id_type       TEXT NOT NULL,
  originator_id_hashed     TEXT NOT NULL,                    -- never plain
  originator_address       TEXT NOT NULL,
  originator_dob           DATE,
  originator_jurisdiction  CHAR(2) NOT NULL,
  beneficiary_id_type      TEXT NOT NULL,
  beneficiary_id_hashed    TEXT NOT NULL,
  beneficiary_address      TEXT NOT NULL,
  beneficiary_dob          DATE,
  beneficiary_jurisdiction CHAR(2) NOT NULL,
  purpose_of_payment       TEXT NOT NULL,
  sanctions_screened_at    TIMESTAMPTZ,
  sanctions_hit            BOOLEAN NOT NULL DEFAULT false,
  enforced_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tr_xbtx_idx ON travel_rule_records(crossborder_tx_id);
CREATE INDEX IF NOT EXISTS tr_jurisdiction_idx ON travel_rule_records(originator_jurisdiction, beneficiary_jurisdiction);
```

**Service:** `enforce(client, envelope)` validates required fields, hashes IDs (already hashed in envelope per the locked shape — the rail never sees plain), runs sanctions screening on both originator and beneficiary names + jurisdictions, persists the record. If sanctions hit on either side → reject the cross-border transaction with `TRAVEL_RULE_SANCTIONS_HIT`.

**Inbound flow.** When receiving an XB transaction from a foreign rail, the rail extracts the foreign-supplied travel rule data, persists it, runs the same checks. If the foreign rail didn't provide complete travel rule data, the inbound transaction is rejected with `TRAVEL_RULE_INCOMPLETE` and the foreign rail is informed via the standard reversal flow.

**Cross-jurisdiction sanctions.** Sanctions are checked against both the originator's jurisdiction's lists and the beneficiary's jurisdiction's lists.

**Audit.** Every enforcement writes `travel_rule.enforced` with the (hashed) IDs and the result. Regulators can replay the audit log to prove compliance.

**Exit checks:** standard. Tests:
- Outbound enforce with all fields → record persisted, no sanctions hit
- Outbound enforce with sanctions hit → cross-border tx rejected
- Inbound: foreign rail sends complete travel rule → record persisted as INBOUND
- Inbound: foreign rail missing fields → rejected with TRAVEL_RULE_INCOMPLETE

---

## B9.6 — Cross-border disputes + settlement asset interface + Phase 9 exit gate

**Purpose.** Three things in one block. (1) Cross-border-specific dispute reason codes (foreign rail rejected after we committed; FX rate dispute; settlement asset failure). (2) Pluggable settlement-asset interface so CBDC and stablecoin can be plugged in later. (3) Phase 9 exit demo that proves the whole flow.

**Files to create.**
- **Patch:** `modules/disputes/codes.js` — add `XB_FOREIGN_REJECT`, `XB_FX_DISPUTE`, `XB_SETTLEMENT_ASSET_FAILED` reason codes with their SLA windows.
- `modules/settlement-assets/schema.js`
- `modules/settlement-assets/asset-client.js`        — pluggable interface
- `modules/settlement-assets/local-currency-client.js` — default
- `modules/settlement-assets/cbdc-fake.js`            — fake adapter
- `modules/settlement-assets/stablecoin-fake.js`     — fake adapter
- `modules/settlement-assets/service.js`
- `modules/settlement-assets/controller.js`
- `modules/settlement-assets/routes.js`
- `modules/settlement-assets/server.js` (port 4805)
- `modules/settlement-assets/index.js`
- `modules/settlement-assets/tests/settlement-assets.test.js`
- `scripts/demo-phase-9.sh`
- `tests/phase-9-crossborder-e2e.test.js`

**Settlement asset interface:**

```js
export const createSettlementAssetClient = ({ assetType, ... }) => ({
  // For LOCAL_CURRENCY_NET: defers to standard PAPSS/foreign-rail flow
  // For CBDC: would call BoG e-Cedi node; fake just simulates
  // For STABLECOIN: would call a stablecoin custody/issuance API; fake simulates
  
  settle: async ({ payAmountMinor, payCurrency, receiveAmountMinor, receiveCurrency, foreignRailCode, txId }) =>
    ({ ok: true | false, settlementRef, settledAt })
});
```

The `LOCAL_CURRENCY_NET` adapter is the default and is what the simulator uses. CBDC and stablecoin adapters slot in via env config in production.

**Demo flow:**
1. Setup: 2 domestic participants active, 3 foreign rails registered (PAPSS_FAKE, NIBSS_FAKE, BIS_NEXUS_FAKE).
2. FX quote: GHS→NGN 100 GHS → ~1542 NGN at rate 15.42.
3. Lock + ingest XB_CRDT_TRF envelope through the orchestrator.
4. Coordinator commits both ledger legs in one transaction.
5. Worker calls foreign rail (NIBSS_FAKE simulator), gets ACCEPTED, transitions to CONFIRMED.
6. Receipt issued to originator; foreign-tx-id stored.
7. Cross-border to a force-fail account `9999100002` → REJECTED → compensating ledger legs posted → originator made whole.
8. Cross-border with timeout `9999100007` → recovery worker → eventually CONFIRMED via status-check.
9. Travel rule with sanctions hit → blocked at enforcement.
10. CBDC settlement asset (CBDC_FAKE adapter): same flow, different settlement leg → CONFIRMED.
11. Cross-border dispute filed (`XB_FOREIGN_REJECT` reason) → goes through standard Phase 7 flow with extended SLA.
12. Print `PHASE 9 OK`.

**Phase 9 exit gate (paste output):**
- `bash scripts/demo-phase-9.sh` — prints `PHASE 9 OK`
- `pnpm vitest run` — all green; expect ~1080+ total
- `pnpm lint`, `pnpm check-boundaries` — clean
- `pnpm reset && pnpm migrate && pnpm seed` — 48 migrations apply clean
- `git log --oneline | head -85` — shows 6 phase-9 commits

When this passes, Phase 9 is done. Stop. Wait for "continue to Phase 10."

---

## What "PHASE 9 OK" unlocks

After Phase 9:
- The rail handles cross-border payments natively. A Ghanaian customer can pay a Nigerian recipient in NGN through PAPSS, atomically, with FX rate locked, with travel rule enforced.
- The whole foundation built in Phases 1-8 carries through: same envelope, same fraud checks, same disputes, same audit trail, same ledger correctness.
- The pluggable settlement-asset interface is ready for e-Cedi, real PAPSS, and BIS Nexus when those adapters are built.
- The rail is structurally complete. Phase 10 is operations and observability — the things that make the rail run for years, not just work end-to-end.
