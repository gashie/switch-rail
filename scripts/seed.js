import { writeFileSync } from 'node:fs';
import { config } from '../core/config.js';
import { closePool, query } from '../core/db.js';
import { authService } from '../modules/auth/index.js';
import { cryptoKeysService } from '../modules/crypto-keys/index.js';
import { participantsService } from '../modules/participants/index.js';
import { participantOnboardingService } from '../modules/participant-onboarding/index.js';
import { directoryService } from '../modules/directory/index.js';
import { feesService } from '../modules/fees/index.js';
import { eodService } from '../modules/eod/index.js';

const ADMIN_EMAIL = 'admin@sika.local';
const ADMIN_PASSWORD = 'admin1234';
const ADMIN_NAME = 'Admin';

const DEMO_PARTICIPANTS = Object.freeze([
  {
    code: 'DEMO_BANK',
    name: 'Demo Bank',
    legalName: 'Demo Bank PLC',
    type: 'BANK',
    bic: 'DEMOGHACAAA',
    supportedFormats: ['ISO20022', 'REST']
  },
  {
    code: 'DEMO_WALLET',
    name: 'Demo Wallet',
    legalName: 'Demo Wallet Operator Ltd',
    type: 'WALLET',
    bic: 'DEMOGHACBBB',
    supportedFormats: ['REST']
  },
  {
    code: 'DEMO_FINTECH',
    name: 'Demo Fintech',
    legalName: 'Demo Fintech Ltd',
    type: 'FINTECH',
    bic: 'DEMOGHACCCC',
    supportedFormats: ['REST']
  },
  // BANK_TEST hosts the deterministic force-account range 9999000001-9999000010
  // documented in PHASE-4. Demo and integration scripts use it to drive the
  // simulator into specific outcomes (success, AM04, AC04, timeout, etc.).
  {
    code: 'BANK_TEST',
    name: 'Test Bank',
    legalName: 'Test Bank Sandbox Ltd',
    type: 'BANK',
    bic: 'TESTGHACAAA',
    supportedFormats: ['REST', 'ISO20022', 'ISO8583']
  },
  // Phase 5 demo participants used by scripts/demo-phase-5.sh.
  {
    code: 'P5BANK01',
    name: 'Phase 5 Bank One',
    legalName: 'Phase 5 Bank One PLC',
    type: 'BANK',
    bic: 'P5BANK01',
    supportedFormats: ['REST']
  },
  {
    code: 'P5BANK02',
    name: 'Phase 5 Bank Two',
    legalName: 'Phase 5 Bank Two PLC',
    type: 'BANK',
    bic: 'P5BANK02',
    supportedFormats: ['REST']
  }
]);

// Names align with the NIA fake registry so Phase 3 demos can verify
// Ghanacard PINs against accounts whose registered names match.
const DEMO_ACCOUNTS = Object.freeze([
  { participantCode: 'DEMO_BANK', accountNumber: '1000000001', accountName: 'Kofi Mensah' },
  { participantCode: 'DEMO_BANK', accountNumber: '1000000002', accountName: 'Ama Owusu' },
  { participantCode: 'DEMO_WALLET', accountNumber: '0244000001', accountName: 'Kofi Mensah' },
  { participantCode: 'DEMO_WALLET', accountNumber: '0244000002', accountName: 'Ama Owusu' },
  { participantCode: 'DEMO_FINTECH', accountNumber: '2000000001', accountName: 'Kwame Asante' },
  { participantCode: 'DEMO_FINTECH', accountNumber: '2000000002', accountName: 'Demo Merchant Ltd' },
  // Force-account range under BANK_TEST. The simulator's hardcoded rules
  // table (modules/participant-simulator/rules.js) drives the actual
  // behaviour by account number; the directory rows just make these accounts
  // resolvable so the orchestrator's account-status check can pass.
  { participantCode: 'BANK_TEST', accountNumber: '9999000001', accountName: 'Force Success' },
  { participantCode: 'BANK_TEST', accountNumber: '9999000002', accountName: 'Force AM04' },
  { participantCode: 'BANK_TEST', accountNumber: '9999000003', accountName: 'Force AC04' },
  { participantCode: 'BANK_TEST', accountNumber: '9999000004', accountName: 'Force AC06' },
  { participantCode: 'BANK_TEST', accountNumber: '9999000005', accountName: 'Force AG01' },
  { participantCode: 'BANK_TEST', accountNumber: '9999000006', accountName: 'Force RR04' },
  { participantCode: 'BANK_TEST', accountNumber: '9999000007', accountName: 'Force Timeout' },
  { participantCode: 'BANK_TEST', accountNumber: '9999000008', accountName: 'Force Slow' },
  { participantCode: 'BANK_TEST', accountNumber: '9999000009', accountName: 'Force Intermittent' },
  { participantCode: 'BANK_TEST', accountNumber: '9999000010', accountName: 'Force Unreachable' },
  // Phase 5 demo accounts.
  { participantCode: 'P5BANK01', accountNumber: '5100000001', accountName: 'P5 Sender' },
  { participantCode: 'P5BANK02', accountNumber: '5200000001', accountName: 'P5 Receiver' }
]);

const KYB_DOCS = ['INCORPORATION', 'BOG_LICENSE', 'TAX_CERT', 'BENEFICIAL_OWNERS', 'AML_POLICY'];
const CERT_SUITES = ['ENVELOPE_ROUNDTRIP', 'CREDIT_LEG', 'IDEMPOTENCY', 'NAME_ENQUIRY'];

const seedAdmin = async () => {
  try {
    const u = await authService.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      name: ADMIN_NAME
    });
    return { id: u.id, email: u.email, created: true };
  } catch (e) {
    if (e.code !== 'CONFLICT') throw e;
    const r = await query('SELECT id, email FROM users WHERE email = $1', [ADMIN_EMAIL]);
    return { id: r.rows[0].id, email: r.rows[0].email, created: false };
  }
};

const setSimulatorEndpoints = async (code) => {
  // The demo-mode monolith mounts the participant simulator at /simulator.
  // Each onboarded participant gets its credit-leg/status-check/reversal
  // endpoints pointed at this in-process simulator so dev/test runs need
  // no real bank stack to drive a payment end-to-end.
  const base = `http://localhost:${config.port}`;
  await query(
    `UPDATE participants SET endpoints = $2::jsonb, updated_at = now() WHERE code = $1`,
    [
      code,
      JSON.stringify({
        credit_leg: `${base}/simulator/${code}/credit-leg`,
        status_check: `${base}/simulator/${code}/status-check`,
        reversal: `${base}/simulator/${code}/reversal`
      })
    ]
  );
};

const onboardDemoParticipant = async (def) => {
  const created = await participantsService.create(def);
  if (created.deduped) {
    await setSimulatorEndpoints(def.code);
    return { code: def.code, status: created.participant.status, created: false };
  }
  // Walk the full state machine: pending → kyb → certifying → active.
  for (const docType of KYB_DOCS) {
    await participantOnboardingService.uploadKyb({
      code: def.code,
      docType,
      fileName: `${docType.toLowerCase()}.pdf`,
      fileBuffer: Buffer.from(`seed-${def.code}-${docType}`),
      uploadedBy: null
    });
    await participantOnboardingService.reviewKyb({
      code: def.code,
      docType,
      status: 'approved',
      note: 'auto-approved by seed',
      reviewedBy: null
    });
  }
  await participantOnboardingService.transition({
    code: def.code,
    to: 'certifying',
    actorId: null
  });
  for (const suite of CERT_SUITES) {
    await participantOnboardingService.runCertSuite({ code: def.code, suite });
  }
  await participantOnboardingService.transition({
    code: def.code,
    to: 'active',
    actorId: null
  });
  await setSimulatorEndpoints(def.code);
  return { code: def.code, status: 'active', created: true };
};

const accountTypeFor = (participantCode) => {
  if (participantCode === 'DEMO_WALLET') return 'WALLET';
  return 'BANK_ACCOUNT';
};

const seedDemoAccounts = async () => {
  const out = [];
  for (const a of DEMO_ACCOUNTS) {
    const r = await directoryService.register({
      participantCode: a.participantCode,
      accountType: accountTypeFor(a.participantCode),
      accountNumber: a.accountNumber,
      accountName: a.accountName,
      currency: 'GHS'
    });
    out.push({
      participantCode: a.participantCode,
      accountNumber: a.accountNumber,
      accountName: a.accountName,
      deduped: r.deduped
    });
  }
  return out;
};

const main = async () => {
  if (config.env === 'production') {
    throw new Error('seed.js is dev-only and refuses to run when NODE_ENV=production');
  }

  const summary = {
    admin: await seedAdmin(),
    railKey: null,
    participants: [],
    accounts: []
  };

  const rk = await cryptoKeysService.ensureRailKey();
  summary.railKey = { kid: rk.kid, created: rk.created };

  for (const def of DEMO_PARTICIPANTS) {
    const r = await onboardDemoParticipant(def);
    summary.participants.push(r);
  }
  summary.accounts = await seedDemoAccounts();

  // Phase 5 — open today's operating day so the orchestrator's CONFIRMED
  // ledger posts have a calendar to land on.
  const today = await eodService.ensureToday();
  summary.operatingDay = {
    operatingDate: today.operating_date instanceof Date
      ? today.operating_date.toISOString().slice(0, 10)
      : today.operating_date,
    state: today.state
  };

  // Phase 5 — default fee schedules. Locked per PHASE-5 spec:
  // GHS DOMESTIC_INSTANT       = flat 50 minor (GHS 0.50)
  // GHS MOBILE_MONEY_INTEROP   = pct 25 bps, min 50, max 5000
  const feeSchedules = [];
  try {
    feeSchedules.push(
      await feesService.publishSchedule({
        scheduleCode: 'P5-GHS-DOMESTIC-INSTANT-V1',
        railClass: 'DOMESTIC_INSTANT',
        currency: 'GHS',
        feeType: 'FLAT',
        flatMinor: '50',
        bearer: 'DEBT'
      })
    );
    feeSchedules.push(
      await feesService.publishSchedule({
        scheduleCode: 'P5-GHS-MMI-V1',
        railClass: 'MOBILE_MONEY_INTEROP',
        currency: 'GHS',
        feeType: 'PERCENTAGE',
        pctBps: 25,
        minFeeMinor: '50',
        maxFeeMinor: '5000',
        bearer: 'DEBT'
      })
    );
  } catch (e) {
    if (e.code !== 'IDEMPOTENCY_CONFLICT') throw e;
  }
  summary.feeSchedules = feeSchedules.map((s) => ({
    code: s.schedule_code,
    railClass: s.rail_class,
    currency: s.currency,
    feeType: s.fee_type
  }));

  writeFileSync('seed.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
};

main()
  .then(() => closePool())
  .catch((err) => {
    console.error(err.message || err);
    closePool().finally(() => process.exit(1));
  });
