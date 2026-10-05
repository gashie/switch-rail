import { uuidv7 } from '../../core/uuid.js';
import { normalizeForCompare } from '../../core/strings.js';
import { LOCAL_PROVIDER } from './providers/local.js';
import { OFAC_FAKE_PROVIDER } from './providers/ofac-fake.js';
import { UN_FAKE_PROVIDER } from './providers/un-fake.js';
import { BOG_FAKE_PROVIDER } from './providers/bog-fake.js';

const ALL_PROVIDERS = [LOCAL_PROVIDER, OFAC_FAKE_PROVIDER, UN_FAKE_PROVIDER, BOG_FAKE_PROVIDER];

export const createSanctionsService = ({ db, model, screener }) => {
  const upsertEntry = (input) =>
    db.withTransaction(async (client) => {
      const aliases = input.aliases || [];
      const aliasNorms = aliases.map((a) => normalizeForCompare(a));
      return model.insertEntry(client, {
        id: uuidv7(),
        source: input.source,
        listType: input.listType,
        sourceRecordId: input.sourceRecordId,
        primaryName: input.primaryName,
        primaryNameNorm: normalizeForCompare(input.primaryName),
        aliases,
        aliasNorms,
        countries: input.countries,
        dateOfBirth: input.dateOfBirth,
        ghanacardPin: input.ghanacardPin,
        accountNumbers: input.accountNumbers,
        reason: input.reason,
        metadata: input.metadata
      });
    });

  const removeEntry = (id) =>
    db.withTransaction(async (client) => {
      await model.removeEntry(client, id);
      return { id, removed: true };
    });

  const findById = (id) => db.withClient((c) => model.findById(c, id));

  const listEntries = (filters) =>
    db.withClient((c) => model.listEntries(c, filters || {}));

  const screen = ({ name, accountNumber, ghanacardPin, party, transactionId, client }) => {
    if (client && typeof client.query === 'function') {
      return screener.screen({ name, accountNumber, ghanacardPin, party, client, transactionId });
    }
    return db.withClient((c) =>
      screener.screen({ name, accountNumber, ghanacardPin, party, client: c, transactionId })
    );
  };

  const seedFakeProviders = async () =>
    db.withTransaction(async (client) => {
      const out = { source: {}, total: 0 };
      for (const p of ALL_PROVIDERS) {
        const entries = p.fetchEntries();
        let inserted = 0;
        for (const e of entries) {
          const existing = await model.findBySourceRecord(client, p.source, e.sourceRecordId);
          if (existing) continue;
          const aliases = e.aliases || [];
          const aliasNorms = aliases.map((a) => normalizeForCompare(a));
          await model.insertEntry(client, {
            id: uuidv7(),
            source: p.source,
            listType: e.listType,
            sourceRecordId: e.sourceRecordId,
            primaryName: e.primaryName,
            primaryNameNorm: normalizeForCompare(e.primaryName),
            aliases,
            aliasNorms,
            countries: e.countries || null,
            dateOfBirth: e.dateOfBirth || null,
            ghanacardPin: e.ghanacardPin || null,
            accountNumbers: e.accountNumbers || null,
            reason: e.reason,
            metadata: e.metadata
          });
          inserted += 1;
        }
        out.source[p.source] = inserted;
        out.total += inserted;
      }
      return out;
    });

  const listScreeningsForTransaction = (transactionId) =>
    db.withClient((c) => model.listScreeningsForTransaction(c, transactionId));

  return {
    upsertEntry,
    removeEntry,
    findById,
    listEntries,
    screen,
    seedFakeProviders,
    listScreeningsForTransaction
  };
};
