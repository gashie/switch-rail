// Pluggable participant-feed client. Phase 5 ships only the `fake` mode —
// real integrations slot in later phases. The fake mirrors the rail's own
// ledger so by definition there are no breaks; tests inject mutations into
// the returned entries to exercise the break paths.

import { createReconModel } from './model.js';

const railModel = createReconModel();

const fakeFetch = async (db, { participantCode, currency, operatingDate }) => {
  // Identity feed: re-emit the rail's view as if it were the participant's
  // own books. Used in the `fake` mode and as a deterministic baseline.
  const rows = await db.withClient((c) =>
    railModel.railView(c, { participantCode, currency, operatingDate })
  );
  return {
    entries: rows.map((r) => ({
      ref: r.id,
      endToEndId: r.end_to_end_id,
      amountMinor: String(r.amount_value),
      currency: r.amount_currency,
      state: r.state === 'CONFIRMED' ? 'credited' : r.state.toLowerCase(),
      postedAt: null
    }))
  };
};

export const createParticipantFeedClient = ({ db, mode = 'fake', overrideFetch } = {}) => ({
  mode,
  fetch: overrideFetch
    ? overrideFetch
    : (input) => {
        if (mode === 'fake') return fakeFetch(db, input);
        // Real integrations land in Phase 10. Until then, refuse loudly so
        // an operator misconfiguring `recon_feed_mode` notices.
        return Promise.resolve({
          entries: [],
          warning: `feed mode '${mode}' not implemented yet (Phase 10 fills)`
        });
      }
});
