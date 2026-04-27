// Internal rail-managed greylist. Operators manage these via the admin
// API; the seed below installs a small set so demo flows have something
// to match against. Real Phase 10+ integrations swap fakes for live feeds.

export const LOCAL_PROVIDER = {
  source: 'INTERNAL',
  fetchEntries: () => [
    {
      sourceRecordId: 'INT-001',
      listType: 'GREYLIST',
      primaryName: 'TEST GREYLIST PERSON',
      aliases: [],
      countries: ['GH'],
      reason: 'placeholder for operator-managed greylist'
    }
  ]
};
