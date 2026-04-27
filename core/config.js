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
  currencyDefault: process.env.CURRENCY_DEFAULT || 'GHS',
  // standalone-mode ports for `node modules/<n>/server.js`
  authPort: Number(process.env.AUTH_PORT || 4001),
  auditPort: Number(process.env.AUDIT_PORT || 4002),
  cryptoKeysPort: Number(process.env.CRYPTO_KEYS_PORT || 4003),
  envelopePort: Number(process.env.ENVELOPE_PORT || 4101),
  adaptersRestPort: Number(process.env.ADAPTERS_REST_PORT || 4102),
  adaptersIso20022Port: Number(process.env.ADAPTERS_ISO20022_PORT || 4103),
  adaptersIso8583Port: Number(process.env.ADAPTERS_ISO8583_PORT || 4104),
  adaptersSwiftPort: Number(process.env.ADAPTERS_SWIFT_PORT || 4105),
  adaptersBulkPort: Number(process.env.ADAPTERS_BULK_PORT || 4106),
  participantsPort: Number(process.env.PARTICIPANTS_PORT || 4201),
  directoryPort: Number(process.env.DIRECTORY_PORT || 4202),
  aliasesPort: Number(process.env.ALIASES_PORT || 4203),
  nameEnquiryPort: Number(process.env.NAME_ENQUIRY_PORT || 4204),
  participantOnboardingPort: Number(process.env.PARTICIPANT_ONBOARDING_PORT || 4205),
  transactionsPort: Number(process.env.TRANSACTIONS_PORT || 4301),
  routingPort: Number(process.env.ROUTING_PORT || 4302),
  participantSimulatorPort: Number(process.env.PARTICIPANT_SIMULATOR_PORT || 4303),
  creditLegPort: Number(process.env.CREDIT_LEG_PORT || 4304),
  transactionReceiptsPort: Number(process.env.TRANSACTION_RECEIPTS_PORT || 4305),
  reversalsPort: Number(process.env.REVERSALS_PORT || 4306),
  // Phase 5 — settlement, liquidity, EOD
  ledgerPort: Number(process.env.LEDGER_PORT || 4401),
  settlementPort: Number(process.env.SETTLEMENT_PORT || 4402),
  liquidityPort: Number(process.env.LIQUIDITY_PORT || 4403),
  settlementCyclePort: Number(process.env.SETTLEMENT_CYCLE_PORT || 4404),
  eodPort: Number(process.env.EOD_PORT || 4405),
  reconciliationPort: Number(process.env.RECONCILIATION_PORT || 4406),
  feesPort: Number(process.env.FEES_PORT || 4407),
  operatorTimezone: process.env.OPERATOR_TIMEZONE || 'Africa/Accra',
  intradayCycleHours: Number(process.env.INTRADAY_CYCLE_HOURS || 4),
  reconBreakAgeSeconds: Number(process.env.RECON_BREAK_AGE_SECONDS || 900),
  reconFeedMode: process.env.RECON_FEED_MODE || 'fake',
  niaMode: process.env.NIA_MODE || 'fake',
  // Phase 4: when running tests we want short timeouts; production demo uses
  // the full 10s/2s budgets. Override with TX_TEST_MODE=true.
  txTestMode: (process.env.TX_TEST_MODE || 'false') === 'true'
});
