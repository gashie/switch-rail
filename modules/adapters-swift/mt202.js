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

export const parseMT202 = (text) => {
  const blocks = parseSwiftBlocks(text);
  if (!blocks['4']) throw new Error('not an MT202: missing block 4');
  const f = parseBlock4Fields(blocks['4']);

  const ref = f['20'];
  if (!ref) throw new Error('MT202 missing tag 20');

  const m32a = (f['32A'] || '').match(/^(\d{6})([A-Z]{3})([\d,.]+)$/);
  if (!m32a) throw new Error('MT202 invalid 32A field');
  const settlementDate = swiftDateToIso(m32a[1]);
  const currency = m32a[2];
  const amountValue = swiftAmountToMinor(m32a[3], currency);

  const orderingBic = (f['52A'] || '').trim() || undefined;
  const beneficiaryBic = (f['58A'] || '').trim() || undefined;
  const intermediaryBic = (f['56A'] || '').trim() || undefined;

  const metadata = {};
  if (f['21']) metadata.relatedReference = f['21'];
  if (intermediaryBic) metadata.intermediaryBic = intermediaryBic;

  return createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'SWIFT_MT',
    sourceMessageId: ref,
    endToEndId: f['21'] || ref,
    idempotencyKey: `swift:mt202:${ref}`.padEnd(8, 'x').slice(0, 128),
    originator: {
      participantCode: orderingBic ? orderingBic.slice(0, 8) : 'UNKNOWN',
      accountId: orderingBic || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: orderingBic ? `BANK ${orderingBic}` : 'UNKNOWN',
      bic: orderingBic
    },
    beneficiary: {
      participantCode: beneficiaryBic ? beneficiaryBic.slice(0, 8) : 'UNKNOWN',
      accountId: beneficiaryBic || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: beneficiaryBic ? `BANK ${beneficiaryBic}` : 'UNKNOWN',
      bic: beneficiaryBic
    },
    amount: { value: amountValue, currency },
    settlementDate,
    metadata
  });
};

export const formatMT202 = (env) => {
  const meta = env.metadata || {};
  const block1 = `F01${(env.originator.bic || 'XXXXXXXX').padEnd(11, 'X')}0000000000`;
  const block2 = `I202${(env.beneficiary.bic || 'XXXXXXXX').padEnd(11, 'X')}N`;
  const settlementDate = env.settlementDate || `2026-01-01`;
  const block4Fields = {
    '20': env.sourceMessageId.slice(0, 16),
    '21': meta.relatedReference || env.endToEndId.slice(0, 16),
    '32A':
      isoDateToSwift(settlementDate) +
      env.amount.currency +
      minorToSwiftAmount(env.amount.value, env.amount.currency),
    '52A': env.originator.bic || undefined,
    '56A': meta.intermediaryBic || undefined,
    '58A': env.beneficiary.bic || undefined
  };
  return buildSwiftMessage({ block1, block2, block4Fields });
};
