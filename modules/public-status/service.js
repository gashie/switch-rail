import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';

export const createPublicStatusService = ({ db, model }) => ({
  declareIncident: ({ scope, severity, title, description, metadata, declaredBy }) =>
    db.withTransaction(async (c) => {
      const id = uuidv7();
      const incident = await model.insertIncident(c, {
        id, scope, severity, title, description, declaredBy, metadata
      });
      await auditService.record(c, {
        actorType: 'operator',
        actorId: declaredBy,
        eventType: 'status.incident_declared',
        resourceType: 'status_incident',
        resourceId: id,
        payload: { scope, severity, title }
      });
      return incident;
    }),

  postUpdate: ({ incidentId, body, postedBy }) =>
    db.withTransaction((c) =>
      model.insertUpdate(c, { id: uuidv7(), incidentId, body, postedBy })
    ),

  resolveIncident: ({ incidentId, closingNote, postedBy }) =>
    db.withTransaction(async (c) => {
      const updated = await model.resolve(c, {
        id: incidentId, closingNote, postedBy, updateId: uuidv7()
      });
      if (updated) {
        await auditService.record(c, {
          actorType: 'operator',
          actorId: postedBy,
          eventType: 'status.incident_resolved',
          resourceType: 'status_incident',
          resourceId: incidentId,
          payload: { closingNote }
        });
      }
      return updated;
    }),

  listOpen: () => db.withClient((c) => model.listOpen(c)),
  listRecent: (opts = {}) => db.withClient((c) => model.listRecent(c, { limit: opts.limit ?? 20 })),
  listUpdates: ({ incidentId }) => db.withClient((c) => model.listUpdates(c, { incidentId })),
  verifyReceipt: ({ transactionId }) => db.withClient((c) => model.verifyReceipt(c, { transactionId }))
});
