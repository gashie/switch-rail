// EMVCo MPM decoder. Walks the TLV string, validates the trailing CRC,
// and returns a structured object. Hostile input (truncated TLVs, bad
// lengths) returns an explicit error rather than throwing.

import { AppError } from '../../core/errors.js';
import { crc16ccittFalse } from './emvco-encoder.js';
import { CURRENCY_NUMERIC, SIKA_MAI_TAG, SIKA_GUI } from './codes.js';

const reverseCcy = Object.fromEntries(
  Object.entries(CURRENCY_NUMERIC).map(([k, v]) => [v, k])
);

const parseTlvs = (s) => {
  const out = [];
  let i = 0;
  while (i < s.length) {
    if (i + 4 > s.length) {
      throw new AppError('VALIDATION_FAILED', `truncated TLV at offset ${i}`, 400);
    }
    const id = s.slice(i, i + 2);
    const lenStr = s.slice(i + 2, i + 4);
    const len = parseInt(lenStr, 10);
    if (Number.isNaN(len) || lenStr.length !== 2) {
      throw new AppError('VALIDATION_FAILED', `bad TLV length at offset ${i}: ${lenStr}`, 400);
    }
    if (i + 4 + len > s.length) {
      throw new AppError('VALIDATION_FAILED', `TLV at offset ${i} (id ${id}, len ${len}) exceeds payload`, 400);
    }
    const value = s.slice(i + 4, i + 4 + len);
    out.push({ id, value });
    i += 4 + len;
  }
  return out;
};

export const decodeMpm = (encoded) => {
  if (typeof encoded !== 'string' || encoded.length < 8) {
    throw new AppError('VALIDATION_FAILED', 'encoded payload too short', 400);
  }

  // The CRC is the last 4 chars of the trailing tag-63 TLV. Find it.
  const crcMarker = '6304';
  const crcStart = encoded.lastIndexOf(crcMarker);
  if (crcStart === -1 || crcStart + 8 !== encoded.length) {
    throw new AppError('VALIDATION_FAILED', 'CRC tag missing or malformed', 400);
  }
  const supplied = encoded.slice(crcStart + 4);
  const computed = crc16ccittFalse(encoded.slice(0, crcStart + 4));
  if (supplied.toUpperCase() !== computed) {
    throw new AppError('VALIDATION_FAILED', `CRC mismatch (got ${supplied}, expected ${computed})`, 400);
  }

  const head = parseTlvs(encoded.slice(0, crcStart));
  const get = (id) => head.find((t) => t.id === id)?.value ?? null;

  const mai = get(SIKA_MAI_TAG);
  if (!mai) {
    throw new AppError('VALIDATION_FAILED', `merchant account info tag ${SIKA_MAI_TAG} missing`, 400);
  }
  const inner = parseTlvs(mai);
  const innerGet = (id) => inner.find((t) => t.id === id)?.value ?? null;
  const gui = innerGet('00');
  if (gui !== SIKA_GUI) {
    throw new AppError('VALIDATION_FAILED', `unknown GUI ${gui}, expected ${SIKA_GUI}`, 400);
  }
  const merchantParticipant = innerGet('01');
  const merchantAccountValue = innerGet('02');

  const poi = get('01');
  const qrType = poi === '11' ? 'STATIC' : poi === '12' ? 'DYNAMIC' : null;
  if (!qrType) {
    throw new AppError('VALIDATION_FAILED', `unknown POI value ${poi}`, 400);
  }
  const ccyNum = get('53');
  const currency = reverseCcy[ccyNum];
  if (!currency) {
    throw new AppError('VALIDATION_FAILED', `unsupported currency code ${ccyNum}`, 400);
  }

  const additionalData = get('62');
  let reference = null;
  if (additionalData) {
    const innerData = parseTlvs(additionalData);
    reference = innerData.find((t) => t.id === '05')?.value ?? null;
  }

  return {
    payloadFormat: get('00'),
    qrType,
    merchantParticipant,
    merchantAccountValue,
    mcc: get('52'),
    currency,
    amount: get('54'),
    countryCode: get('58'),
    merchantName: get('59'),
    merchantCity: get('60'),
    reference,
    crcOk: true
  };
};
