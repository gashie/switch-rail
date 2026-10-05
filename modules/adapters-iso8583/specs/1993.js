// ISO 8583 — 1993 data element specification (subset used by Sika rail).
// 1993 reuses most 1987 codes; the deltas Phase 2 cares about are the
// alphanumeric character set extension (still ASCII over the wire here)
// and the optional inclusion of DE 23 for card sequence numbers.
import { SPEC_1987 } from './1987.js';

export const SPEC_1993 = Object.freeze({
  ...SPEC_1987,
  23: { type: 'n', varType: 'fixed', length: 3, label: 'Card sequence number' }
});

export const VERSION_1993 = '1993';
