// Fake stablecoin adapter. Simulates an issuer/custody API call. Real
// stablecoin integration would call the issuer's mint/burn API or a custody
// provider's transfer endpoint over mTLS.

import { uuidv7 } from '../../core/uuid.js';

let _forceFail = false;
export const setStablecoinForceFail = (v) => { _forceFail = !!v; };

export const createStablecoinFakeClient = () => ({
  assetType: 'STABLECOIN',
  settle: async ({ payAmountMinor, payCurrency, receiveCurrency, txId }) => {
    if (_forceFail) {
      return {
        ok: false,
        settlementRef: null,
        error: 'STABLECOIN_ISSUER_DEGRADED',
        settledAt: null
      };
    }
    return {
      ok: true,
      settlementRef: `SC-${(txId || uuidv7()).slice(0, 8)}-${Date.now()}`,
      settledAt: new Date().toISOString(),
      note: `stablecoin fake settled ${payAmountMinor} ${payCurrency} -> ${receiveCurrency}`
    };
  }
});
