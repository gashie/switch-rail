import { uuidv7 } from '../../core/uuid.js';

export const createOpsDashboardService = ({ db, model }) => ({
  recordSnapshot: (input) =>
    db.withTransaction((c) => model.insertSnapshot(c, { id: uuidv7(), ...input })),

  listSnapshots: (query) =>
    db.withClient((c) => model.listSnapshots(c, query)),

  summary: ({ windowMinutes }) =>
    db.withClient((c) => model.summarize(c, { windowMinutes }))
});
