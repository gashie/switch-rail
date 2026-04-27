// EMVCo MPM encoder — TLV-format payload terminated with a CRC-16/CCITT-FALSE
// checksum at tag 63. We hand-roll this rather than depend on a QR library
// because Sika emits the encoded string only; image rendering is the
// participant's job.

import { AppError } from '../../core/errors.js';
import {
  PAYLOAD_FORMAT_INDICATOR, POI_STATIC, POI_DYNAMIC,
  SIKA_MAI_TAG, SIKA_GUI, COUNTRY_CODE, CURRENCY_NUMERIC,
  MAX_MERCHANT_NAME, MAX_MERCHANT_CITY
} from './codes.js';

const tlv = (id, value) => {
  if (typeof id !== 'string' || id.length !== 2) {
    throw new AppError('VALIDATION_FAILED', `tlv id must be 2 chars, got ${id}`, 400);
  }
  const v = String(value);
  const len = v.length;
  if (len > 99) {
    throw new AppError('VALIDATION_FAILED', `tlv value for id ${id} exceeds 99 chars (got ${len})`, 400);
  }
  return `${id}${String(len).padStart(2, '0')}${v}`;
};

// CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflect, no xor-out.
// Verified against the EMVCo specification appendix and standard test vectors.
export const crc16ccittFalse = (input) => {
  let crc = 0xFFFF;
  const bytes = Buffer.from(input, 'utf8');
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

const validateLength = (label, value, max) => {
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_FAILED', `${label} must be a string`, 400);
  }
  if (value.length > max) {
    throw new AppError(
      'VALIDATION_FAILED',
      `${label} exceeds max length ${max} (got ${value.length})`,
      400
    );
  }
};

export const encodeMpm = ({
  qrType,                  // 'STATIC' | 'DYNAMIC'
  merchantParticipant,
  merchantAccountValue,    // canonical: account number or alias
  mcc,                     // 4-digit MCC
  currency,                // 'GHS' | 'USD' | ...
  amountMinor,             // optional for static; required for dynamic
  amountFractionDigits = 2,
  merchantName,
  merchantCity,
  reference                // optional Additional Data Field reference
}) => {
  if (qrType !== 'STATIC' && qrType !== 'DYNAMIC') {
    throw new AppError('VALIDATION_FAILED', `qrType must be STATIC or DYNAMIC`, 400);
  }
  if (typeof merchantParticipant !== 'string' || merchantParticipant.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'merchantParticipant required', 400);
  }
  if (typeof merchantAccountValue !== 'string' || merchantAccountValue.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'merchantAccountValue required', 400);
  }
  if (typeof mcc !== 'string' || !/^\d{4}$/.test(mcc)) {
    throw new AppError('VALIDATION_FAILED', `mcc must be a 4-digit string, got ${mcc}`, 400);
  }
  const ccyNum = CURRENCY_NUMERIC[currency];
  if (!ccyNum) {
    throw new AppError('VALIDATION_FAILED', `unsupported currency ${currency}`, 400);
  }
  validateLength('merchantName', merchantName, MAX_MERCHANT_NAME);
  if (merchantCity != null) validateLength('merchantCity', merchantCity, MAX_MERCHANT_CITY);

  // Merchant Account Information — nested TLVs at tag 26.
  const mai =
    tlv('00', SIKA_GUI) +
    tlv('01', merchantParticipant) +
    tlv('02', merchantAccountValue);

  let payload = tlv('00', PAYLOAD_FORMAT_INDICATOR);
  payload += tlv('01', qrType === 'STATIC' ? POI_STATIC : POI_DYNAMIC);
  payload += tlv(SIKA_MAI_TAG, mai);
  payload += tlv('52', mcc);
  payload += tlv('53', ccyNum);
  if (qrType === 'DYNAMIC') {
    if (!amountMinor) {
      throw new AppError('VALIDATION_FAILED', 'dynamic QR requires amountMinor', 400);
    }
    payload += tlv('54', formatAmountFromMinor(amountMinor, amountFractionDigits));
  }
  payload += tlv('58', COUNTRY_CODE);
  payload += tlv('59', merchantName);
  if (merchantCity) payload += tlv('60', merchantCity);
  if (reference) payload += tlv('62', tlv('05', reference));

  // Tag 63 holds the CRC. Per spec, the CRC is computed over the entire
  // payload INCLUDING the "6304" prefix (tag + length).
  const withCrcPrefix = payload + '6304';
  const crc = crc16ccittFalse(withCrcPrefix);
  return withCrcPrefix + crc;
};

// Convert minor units to display form, e.g. 12345 -> "123.45" with 2 fraction digits.
const formatAmountFromMinor = (amountMinor, fractionDigits) => {
  const s = String(amountMinor);
  if (fractionDigits === 0) return s;
  const padded = s.padStart(fractionDigits + 1, '0');
  const intPart = padded.slice(0, -fractionDigits);
  const fracPart = padded.slice(-fractionDigits);
  return `${intPart}.${fracPart}`;
};

export const _internal = { tlv, formatAmountFromMinor };
