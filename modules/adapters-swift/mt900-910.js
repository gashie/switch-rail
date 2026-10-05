import { createEnvelope } from '../envelope/index.js';
import {
  parseSwiftBlocks,
  parseBlock4Fields,
  swiftAmountToMinor,
  swiftDateToIso
} from './parser.js';

const senderBicFromBlock1 = (block1) => {
  if (!block1 || block1.length < 14) return undefined;
  const candidate = block1.slice(3, 14).trim();
  return /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(candidate) ? candidate : undefined;
};

const parseConfirmation = (text, msgKind) => {
  const blocks = parseSwiftBlocks(text);
  if (!blocks['4']) throw new Error(`not an ${msgKind}: missing block 4`);
  const f = parseBlock4Fields(blocks['4']);

  const ref = f['20'];
  if (!ref) throw new Error(`${msgKind} missing tag 20`);

  const m32a = (f['32A'] || '').match(/^(\d{6})([A-Z]{3})([\d,.]+)$/);
  if (!m32a) throw new Error(`${msgKind} invalid 32A field`);
  const settlementDate = swiftDateToIso(m32a[1]);
  const currency = m32a[2];
  const amountValue = swiftAmountToMinor(m32a[3], currency);

  const accountId = (f['25'] || f['25P'] || '').trim() || 'UNKNOWN';
  const senderBic = senderBicFromBlock1(blocks['1']);
  const participantCode = senderBic ? senderBic.slice(0, 8) : 'UNKNOWN';

  return createEnvelope({
    msgType: 'PMT_STATUS',
    sourceFormat: 'SWIFT_MT',
    sourceMessageId: ref,
    endToEndId: f['21'] || ref,
    idempotencyKey: `swift:${msgKind.toLowerCase()}:${ref}`.padEnd(8, 'x').slice(0, 128),
    originator: {
      participantCode,
      accountId,
      accountType: 'BANK_ACCOUNT',
      name: senderBic ? `BANK ${senderBic}` : 'CONFIRMING BANK',
      bic: senderBic
    },
    beneficiary: {
      participantCode,
      accountId,
      accountType: 'BANK_ACCOUNT',
      name: senderBic ? `BANK ${senderBic}` : 'CONFIRMING BANK',
      bic: senderBic
    },
    amount: { value: amountValue, currency },
    settlementDate,
    metadata: {
      confirmationKind: msgKind,
      relatedReference: f['21']
    }
  });
};

export const parseMT900 = (text) => parseConfirmation(text, 'MT900');
export const parseMT910 = (text) => parseConfirmation(text, 'MT910');
