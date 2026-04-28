// Fake CBDC adapter. Simulates a BoG e-Cedi node call: instant settlement
// with a deterministic settlement reference. Real CBDC integration would
// call a national-bank HSM-backed API via mTLS; the contract here matches.

import { uuidv7 } from '../../core/uuid.js';
import { AppError } from '../../core/errors.js';

// Force-fail toggle for test isolation: when true, every settle call returns
// { ok: false, ... }. Tests use this to exercise the failure path.
let _forceFail = false;
export const setCbdcForceFail = (v) => { _forceFail = !!v; };

export const createCbdcFakeClient = () => ({
  assetType: 'CBDC',
  settle: async ({ payAmountMinor, payCurrency, txId }) => {
    if (_forceFail) {
      return {
        ok: false,
        settlementRef: null,
        error: 'CBDC_NODE_UNREACHABLE',
        settledAt: null
      };
    }
    if (!payAmountMinor || !payCurrency) {
      throw new AppError('VALIDATION_FAILED', 'CBDC settle requires payAmountMinor + payCurrency', 400);
    }
    // Simulated instant atomic settlement on the CBDC ledger.
    return {
      ok: true,
      settlementRef: `CBDC-${(txId || uuidv7()).slice(0, 8)}-${Date.now()}`,
      settledAt: new Date().toISOString(),
      note: `CBDC fake settled ${payAmountMinor} ${payCurrency}`
    };
  }
});
