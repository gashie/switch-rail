// ISO 8583 — 2003 data element specification (subset used by Sika rail).
// 2003 widens the character set and adds account-side fields. For the
// Sika 0200 financial-transaction profile, behaviour is the same as 1993
// with the addition of DE 22 (POS entry mode, fixed n12) re-coded.
import { SPEC_1993 } from './1993.js';

export const SPEC_2003 = Object.freeze({
  ...SPEC_1993,
  22: { type: 'n', varType: 'fixed', length: 12, label: 'POS entry mode (2003)' }
});

export const VERSION_2003 = '2003';
