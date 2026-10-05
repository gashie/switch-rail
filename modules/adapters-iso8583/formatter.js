import { encode8583 } from './codec.js';
import { SPEC_1987 } from './specs/1987.js';
import { SPEC_1993 } from './specs/1993.js';
import { SPEC_2003 } from './specs/2003.js';
import { alphaToNumeric } from './currencies.js';

const SPECS = Object.freeze({ 1987: SPEC_1987, 1993: SPEC_1993, 2003: SPEC_2003 });

const MSG_TYPE_TO_MTI = Object.freeze({
  CRDT_TRF: '0200',
  PMT_STATUS: '0210',
  PMT_REVERSAL: '0400'
});

export const format8583 = (envelope, version = '1987', mtiOverride) => {
  const spec = SPECS[String(version)];
  if (!spec) throw new Error(`unknown ISO 8583 version: ${version}`);
  const meta = envelope.metadata || {};
  const mti = mtiOverride || meta.mti || MSG_TYPE_TO_MTI[envelope.msgType];
  if (!mti) throw new Error(`no MTI for msgType ${envelope.msgType}`);

  const fields = {};
  // DE 3
  fields[3] = meta.processingCode || '000000';
  // DE 4 — amount in minor units, padded
  fields[4] = String(envelope.amount.value);
  // DE 7 — transmission date/time
  if (meta.transmissionDateTime) fields[7] = meta.transmissionDateTime;
  // DE 11 — STAN: derive from sourceMessageId (numeric)
  const stan = String(envelope.sourceMessageId || '').replace(/\D/g, '').slice(-6) || '0';
  fields[11] = stan;
  // DE 12, 13
  if (meta.localTime) fields[12] = meta.localTime;
  if (meta.localDate) fields[13] = meta.localDate;
  // DE 32 acquirer
  fields[32] = String(envelope.originator.participantCode);
  // DE 37 retrieval ref
  fields[37] = String(envelope.endToEndId).slice(0, 12).padEnd(12, ' ');
  // DE 41/42
  if (meta.terminalId) fields[41] = meta.terminalId;
  if (meta.acceptorId) fields[42] = meta.acceptorId;
  // DE 43 acceptor name
  fields[43] = String(envelope.originator.name).slice(0, 40);
  // DE 49 currency numeric
  fields[49] = alphaToNumeric(envelope.amount.currency);
  // DE 100 receiver
  fields[100] = String(envelope.beneficiary.participantCode);
  // DE 102 originator account
  fields[102] = String(envelope.originator.accountId);
  // DE 103 beneficiary account
  fields[103] = String(envelope.beneficiary.accountId);

  return encode8583({ mti, fields }, spec);
};
