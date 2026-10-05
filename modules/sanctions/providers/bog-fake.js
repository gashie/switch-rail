export const BOG_FAKE_PROVIDER = {
  source: 'BOG',
  fetchEntries: () => [
    {
      sourceRecordId: 'BOG-FAKE-001',
      listType: 'BLACKLIST',
      primaryName: 'KOFI MUMU',
      aliases: ['K MUMU'],
      countries: ['GH'],
      reason: 'fictitious BoG blacklist test entry'
    },
    {
      sourceRecordId: 'BOG-FAKE-002',
      listType: 'PEP',
      primaryName: 'AMA KUFUOR',
      aliases: [],
      countries: ['GH'],
      reason: 'fictitious BoG PEP test entry'
    }
  ]
};
