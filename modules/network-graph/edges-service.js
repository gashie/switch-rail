import { uuidv7 } from '../../core/uuid.js';

// Writes a graph edge for a confirmed transaction. Called from the post-
// confirmation hook so the edge writer never blocks the hot path.

export const createEdgesService = ({ db, model }) => {
  const recordEdgeForTransaction = async (transaction, { client } = {}) => {
    const fromKey = `${transaction.originator_participant}:${transaction.originator_account}`;
    const toKey = `${transaction.beneficiary_participant}:${transaction.beneficiary_account}`;
    const observedAt = (transaction.confirmed_at || transaction.created_at || new Date()).toISOString
      ? (transaction.confirmed_at || transaction.created_at || new Date()).toISOString()
      : new Date().toISOString();
    const args = {
      id: uuidv7(),
      fromKey,
      toKey,
      edgeType: 'TRANSFER',
      amountMinor: String(transaction.amount_value),
      currency: transaction.amount_currency,
      observedAt
    };
    if (client && typeof client.query === 'function') {
      return model.upsertEdge(client, args);
    }
    return db.withTransaction((c) => model.upsertEdge(c, args));
  };

  const adjacency = (accountKey) =>
    db.withClient(async (c) => ({
      outgoing: await model.outgoingFrom(c, accountKey),
      incoming: await model.incomingTo(c, accountKey)
    }));

  return { recordEdgeForTransaction, adjacency };
};
