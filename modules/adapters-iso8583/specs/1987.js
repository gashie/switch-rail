// ISO 8583 — 1987 data element specification (subset used by Sika rail).
// Field types: n=numeric, an=alphanumeric, ans=alphanumeric+special.
// varType: fixed | LLVAR (2-digit length prefix) | LLLVAR (3-digit prefix).
export const SPEC_1987 = Object.freeze({
  2: { type: 'n', varType: 'LLVAR', maxLength: 19, label: 'PAN' },
  3: { type: 'n', varType: 'fixed', length: 6, label: 'Processing code' },
  4: { type: 'n', varType: 'fixed', length: 12, label: 'Amount, transaction' },
  7: { type: 'n', varType: 'fixed', length: 10, label: 'Transmission date/time' },
  11: { type: 'n', varType: 'fixed', length: 6, label: 'STAN' },
  12: { type: 'n', varType: 'fixed', length: 6, label: 'Local time' },
  13: { type: 'n', varType: 'fixed', length: 4, label: 'Local date' },
  32: { type: 'n', varType: 'LLVAR', maxLength: 11, label: 'Acquirer institution code' },
  37: { type: 'an', varType: 'fixed', length: 12, label: 'Retrieval reference number' },
  41: { type: 'ans', varType: 'fixed', length: 8, label: 'Card acceptor terminal ID' },
  42: { type: 'ans', varType: 'fixed', length: 15, label: 'Card acceptor ID' },
  43: { type: 'ans', varType: 'fixed', length: 40, label: 'Card acceptor name/location' },
  49: { type: 'n', varType: 'fixed', length: 3, label: 'Currency code, transaction' },
  100: { type: 'n', varType: 'LLVAR', maxLength: 11, label: 'Receiving institution code' },
  102: { type: 'ans', varType: 'LLVAR', maxLength: 28, label: 'Account ID 1' },
  103: { type: 'ans', varType: 'LLVAR', maxLength: 28, label: 'Account ID 2' }
});

export const VERSION_1987 = '1987';
