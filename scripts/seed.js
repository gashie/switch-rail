import { writeFileSync } from 'node:fs';
import { config } from '../core/config.js';
import { closePool, query } from '../core/db.js';
import { authService } from '../modules/auth/index.js';
import { cryptoKeysService } from '../modules/crypto-keys/index.js';
import { participantsService } from '../modules/participants/index.js';
import { participantOnboardingService } from '../modules/participant-onboarding/index.js';
import { directoryService } from '../modules/directory/index.js';

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
  { participantCode: 'DEMO_FINTECH', accountNumber: '2000000002', accountName: 'Demo Merchant Ltd' }
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

const onboardDemoParticipant = async (def) => {
  const created = await participantsService.create(def);
  if (created.deduped) {
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
  return { code: def.code, status: 'active', created: true };
};

const seedDemoAccounts = async () => {
  const out = [];
  for (const a of DEMO_ACCOUNTS) {
    const r = await directoryService.register({
      participantCode: a.participantCode,
      accountType:
        a.participantCode === 'DEMO_WALLET' ? 'WALLET' : 'BANK_ACCOUNT',
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

  writeFileSync('seed.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
};

main()
  .then(() => closePool())
  .catch((err) => {
    console.error(err.message || err);
    closePool().finally(() => process.exit(1));
  });
