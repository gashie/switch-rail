import { createEnvelope } from '../envelope/index.js';
import {
  parseSwiftBlocks,
  parseBlock4Fields,
  buildSwiftMessage,
  swiftAmountToMinor,
  minorToSwiftAmount,
  swiftDateToIso,
  isoDateToSwift
} from './parser.js';

const BEARER_FROM_71A = { OUR: 'DEBT', BEN: 'CRED', SHA: 'SHAR' };
const BEARER_TO_71A = { DEBT: 'OUR', CRED: 'BEN', SHAR: 'SHA' };

const splitAccountAndName = (text) => {
  if (!text) return { account: '', name: '' };
  const lines = String(text).split('\n');
  let account = '';
  let nameLines = lines;
  if (lines[0]?.startsWith('/')) {
    account = lines[0].slice(1);
    nameLines = lines.slice(1);
  }
  return { account, name: nameLines.join(' ').trim() };
};

const joinAccountAndName = (account, name) => {
  const acct = account ? `/${account}` : '';
  return name ? `${acct}\n${name}` : acct;
};

export const parseMT103 = (text) => {
  const blocks = parseSwiftBlocks(text);
  if (!blocks['4']) throw new Error('not an MT103: missing block 4');
  const f = parseBlock4Fields(blocks['4']);

  const ref = f['20'];
  if (!ref) throw new Error('MT103 missing tag 20');

  // 32A: YYMMDD + 3-letter currency + decimal amount
  const m32a = (f['32A'] || '').match(/^(\d{6})([A-Z]{3})([\d,.]+)$/);
  if (!m32a) throw new Error('MT103 invalid 32A field');
  const settlementDate = swiftDateToIso(m32a[1]);
  const currency = m32a[2];
  const amountValue = swiftAmountToMinor(m32a[3], currency);

  const orderingBic = (f['52A'] || '').trim() || undefined;
  const beneficiaryBic = (f['57A'] || '').trim() || undefined;

  const { account: dbtrAcct, name: dbtrName } = splitAccountAndName(f['50K'] || f['50A']);
  const { account: cdtrAcct, name: cdtrName } = splitAccountAndName(f['59'] || f['59A']);

  const bearerCode = (f['71A'] || '').trim();
  const fee = bearerCode
    ? {
        value: '0',
        currency,
        bearer: BEARER_FROM_71A[bearerCode] || 'SHAR'
      }
    : null;

  const remittance = (f['70'] || '').replace(/\n/g, ' ').trim() || undefined;

  return createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'SWIFT_MT',
    sourceMessageId: ref,
    endToEndId: ref,
    idempotencyKey: `swift:mt103:${ref}`.padEnd(8, 'x').slice(0, 128),
    originator: {
      participantCode: orderingBic ? orderingBic.slice(0, 8) : 'UNKNOWN',
      accountId: dbtrAcct || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: dbtrName || 'UNKNOWN',
      bic: orderingBic
    },
    beneficiary: {
      participantCode: beneficiaryBic ? beneficiaryBic.slice(0, 8) : 'UNKNOWN',
      accountId: cdtrAcct || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: cdtrName || 'UNKNOWN',
      bic: beneficiaryBic
    },
    amount: { value: amountValue, currency },
    fee,
    remittance,
    settlementDate,
    metadata: {
      bankOpCode: (f['23B'] || '').trim(),
      senderToReceiver: (f['72'] || '').replace(/\n/g, ' ').trim()
    }
  });
};

export const formatMT103 = (env) => {
  const meta = env.metadata || {};
  const block1 = `F01${(env.originator.bic || 'XXXXXXXX').padEnd(11, 'X')}0000000000`;
  const block2 = `I103${(env.beneficiary.bic || 'XXXXXXXX').padEnd(11, 'X')}N`;
  const settlementDate = env.settlementDate || `2026-01-01`;
  const block4Fields = {
    '20': env.endToEndId.slice(0, 16),
    '23B': meta.bankOpCode || 'CRED',
    '32A':
      isoDateToSwift(settlementDate) +
      env.amount.currency +
      minorToSwiftAmount(env.amount.value, env.amount.currency),
    '50K': joinAccountAndName(env.originator.accountId, env.originator.name),
    '52A': env.originator.bic || undefined,
    '57A': env.beneficiary.bic || undefined,
    '59': joinAccountAndName(env.beneficiary.accountId, env.beneficiary.name),
    '70': env.remittance || undefined,
    '71A': env.fee ? BEARER_TO_71A[env.fee.bearer] : undefined,
    '72': meta.senderToReceiver || undefined
  };
  return buildSwiftMessage({ block1, block2, block4Fields });
};
