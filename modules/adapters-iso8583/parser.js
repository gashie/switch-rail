import { createEnvelope } from '../envelope/index.js';
import { decode8583 } from './codec.js';
import { SPEC_1987 } from './specs/1987.js';
import { SPEC_1993 } from './specs/1993.js';
import { SPEC_2003 } from './specs/2003.js';
import { numericToAlpha } from './currencies.js';

const SPECS = Object.freeze({ 1987: SPEC_1987, 1993: SPEC_1993, 2003: SPEC_2003 });

const MTI_TO_MSG_TYPE = Object.freeze({
  '0200': 'CRDT_TRF',
  '0210': 'PMT_STATUS',
  '0220': 'CRDT_TRF',
  '0400': 'PMT_REVERSAL',
  '0420': 'PMT_REVERSAL'
});

export const parse8583 = (buf, version = '1987') => {
  const spec = SPECS[String(version)];
  if (!spec) throw new Error(`unknown ISO 8583 version: ${version}`);
  const { mti, fields } = decode8583(buf, spec);
  const msgType = MTI_TO_MSG_TYPE[mti];
  if (!msgType) throw new Error(`unsupported MTI for Phase 2: ${mti}`);

  const stan = fields[11];
  const transmissionDt = fields[7];
  const acquirer = fields[32];
  const receiver = fields[100];
  const retrievalRef = fields[37];

  const currency = fields[49] ? numericToAlpha(fields[49]) : 'GHS';
  // DE 4 is fixed-12 numeric and round-trips with leading zeros; convert to
  // canonical integer-string form for envelope.amount.value (no leading zeros,
  // never empty).
  const amountValue = fields[4] ? BigInt(fields[4]).toString() : '0';

  const idempotencyKey = `iso8583:${version}:${stan || ''}:${transmissionDt || ''}:${acquirer || ''}`.padEnd(8, 'x').slice(0, 128);

  return createEnvelope({
    msgType,
    sourceFormat: 'ISO8583',
    sourceMessageId: stan || `iso8583-${Date.now()}`,
    endToEndId: retrievalRef || stan || `iso8583-${Date.now()}`,
    idempotencyKey,
    originator: {
      participantCode: acquirer || 'UNKNOWN',
      accountId: fields[102] || fields[2] || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: fields[43] ? fields[43].trim() : 'UNKNOWN'
    },
    beneficiary: {
      participantCode: receiver || 'UNKNOWN',
      accountId: fields[103] || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: 'BENEFICIARY'
    },
    amount: { value: amountValue, currency },
    metadata: {
      mti,
      version,
      processingCode: fields[3],
      transmissionDateTime: transmissionDt,
      localTime: fields[12],
      localDate: fields[13],
      terminalId: fields[41],
      acceptorId: fields[42]
    }
  });
};
