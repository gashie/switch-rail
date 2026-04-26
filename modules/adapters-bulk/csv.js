import { parse as parseCsvSync } from 'csv-parse/sync';
import { createEnvelope } from '../envelope/index.js';

export const REQUIRED_HEADERS = Object.freeze([
  'originator_participant',
  'originator_account',
  'originator_name',
  'beneficiary_participant',
  'beneficiary_account',
  'beneficiary_name',
  'amount_minor',
  'currency',
  'reference',
  'remittance',
  'end_to_end_id'
]);

export const rowToEnvelope = (row, { batchId, rowIndex }) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'BULK_CSV',
    sourceMessageId: `${batchId}:${rowIndex}`,
    endToEndId: String(row.end_to_end_id || `${batchId}:${rowIndex}`),
    idempotencyKey: `bulk:${batchId}:${rowIndex}`,
    originator: {
      participantCode: String(row.originator_participant),
      accountId: String(row.originator_account),
      accountType: 'BANK_ACCOUNT',
      name: String(row.originator_name)
    },
    beneficiary: {
      participantCode: String(row.beneficiary_participant),
      accountId: String(row.beneficiary_account),
      accountType: 'BANK_ACCOUNT',
      name: String(row.beneficiary_name)
    },
    amount: {
      value: String(row.amount_minor).trim(),
      currency: String(row.currency).trim().toUpperCase()
    },
    reference: row.reference ? String(row.reference) : undefined,
    remittance: row.remittance ? String(row.remittance) : undefined
  });

export const parseCsv = (buffer) => {
  const records = parseCsvSync(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true
  });

  if (records.length > 0) {
    const headers = Object.keys(records[0]);
    const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
    if (missing.length > 0) {
      throw new Error(`CSV missing required headers: ${missing.join(', ')}`);
    }
  }
  return records;
};
