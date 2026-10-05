import { chainHash } from '../../core/crypto.js';
import { uuidv7 } from '../../core/uuid.js';

const GENESIS = 'GENESIS';

const formatDayUtc = (d = new Date()) => {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const createAuditService = ({ db, model }) => {
  const recordOnClient = async (
    client,
    { actorType, actorId, eventType, resourceType, resourceId, payload }
  ) => {
    const day = formatDayUtc();
    const prevHash = (await model.getLastHashForDay(client, day)) ?? GENESIS;
    const hash = chainHash(prevHash, payload ?? {});
    const id = uuidv7();
    return model.insertEvent(client, {
      id,
      day,
      actorType,
      actorId,
      eventType,
      resourceType,
      resourceId,
      payload: payload ?? {},
      prevHash,
      hash
    });
  };

  return {
    record: (clientOrInput, maybeInput) => {
      // Two call shapes:
      //   record(client, input)   — caller owns the transaction
      //   record(input)           — service opens its own transaction
      if (clientOrInput && typeof clientOrInput.query === 'function') {
        return recordOnClient(clientOrInput, maybeInput);
      }
      return db.withTransaction((c) => recordOnClient(c, clientOrInput));
    },

    verifyDay: (day) =>
      db.withClient(async (c) => {
        const events = await model.listEventsForDay(c, day);
        let prev = GENESIS;
        for (const e of events) {
          if (e.prev_hash !== prev) return { ok: false, brokenAtSeq: Number(e.seq), reason: 'prev_hash mismatch' };
          const expected = chainHash(prev, e.payload);
          if (e.hash !== expected) return { ok: false, brokenAtSeq: Number(e.seq), reason: 'hash mismatch' };
          prev = e.hash;
        }
        return { ok: true, count: events.length };
      }),

    list: (input) => db.withClient((c) => model.list(c, input))
  };
};

export { formatDayUtc };
