// Fake OFAC entries for tests/demos. The Phase 10 swap replaces this with
// the real OFAC SDN list pull. Names are deliberately recognisable
// fictional people so tests can assert specific matches.

export const OFAC_FAKE_PROVIDER = {
  source: 'OFAC',
  fetchEntries: () => [
    {
      sourceRecordId: 'OFAC-FAKE-001',
      listType: 'SANCTIONS',
      primaryName: 'OSAMA TEST PERSON',
      aliases: ['OSAMA T PERSON', 'OSAMA TESTING'],
      countries: ['XX'],
      reason: 'fictitious sanctions test entry'
    },
    {
      sourceRecordId: 'OFAC-FAKE-002',
      listType: 'SANCTIONS',
      primaryName: 'MARIA SANCIONADA',
      aliases: [],
      countries: ['XX'],
      reason: 'fictitious sanctions test entry'
    },
    {
      sourceRecordId: 'OFAC-FAKE-003',
      listType: 'BLACKLIST',
      primaryName: 'FRAUDSTER ALPHA',
      aliases: ['F ALPHA'],
      countries: ['GH'],
      ghanacardPin: 'GHA-FRAUDSTER-001',
      reason: 'demo blacklist entry'
    }
  ]
};
