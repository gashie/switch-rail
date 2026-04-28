// LOCAL_CURRENCY_NET adapter. Delegates back to the standard PAPSS-style
// foreign-rail flow that's already implemented in crossborder-tx — it
// returns immediately with `ok: true` because the actual settlement is
// the foreign rail's net cycle, handled by the recovery worker. The
// settlement asset interface for this case is essentially a no-op: it
// records that the operating mode is local-currency net, no exotic asset
// movement is needed.

import { uuidv7 } from '../../core/uuid.js';

export const createLocalCurrencyClient = () => ({
  assetType: 'LOCAL_CURRENCY_NET',
  settle: async ({ txId }) => ({
    ok: true,
    settlementRef: `LOCAL-${(txId || uuidv7()).slice(0, 8)}-${Date.now()}`,
    settledAt: new Date().toISOString(),
    note: 'local-currency net — settled via foreign-rail cycle'
  })
});
