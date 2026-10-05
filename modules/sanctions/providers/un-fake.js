export const UN_FAKE_PROVIDER = {
  source: 'UN',
  fetchEntries: () => [
    {
      sourceRecordId: 'UN-FAKE-001',
      listType: 'SANCTIONS',
      primaryName: 'IVAN PRESTUPNIK',
      aliases: [],
      countries: ['XX'],
      reason: 'fictitious UN sanctions test entry'
    },
    {
      sourceRecordId: 'UN-FAKE-002',
      listType: 'PEP',
      primaryName: 'POLITICALLY EXPOSED PERSON',
      aliases: ['PEP TEST'],
      countries: ['GH'],
      reason: 'fictitious PEP test entry'
    }
  ]
};
