import * as XLSX from 'xlsx';
import { REQUIRED_HEADERS } from './csv.js';

export const parseXlsx = (buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error('XLSX has no sheets');
  const sheet = wb.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
    if (missing.length > 0) {
      throw new Error(`XLSX missing required headers: ${missing.join(', ')}`);
    }
  }
  return rows;
};
