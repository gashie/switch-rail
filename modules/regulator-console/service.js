import { auditService } from '../audit/index.js';

export const createRegulatorConsoleService = ({ db, model }) => ({
  dailyDigest: ({ day }) => db.withClient((c) => model.dailyDigest(c, { day })),

  // Logging an export request to the audit chain — this is the regulator's
  // "I requested a copy of these rows on this day for this reason" trail.
  // No PII data is exported here; the operator's data-room handles the
  // file delivery out-of-band.
  logExport: ({ reason, resourceType, filters, actorId }) =>
    db.withTransaction((c) =>
      auditService.record(c, {
        actorType: 'regulator',
        actorId: actorId || null,
        eventType: 'regulator.export_requested',
        resourceType,
        resourceId: null,
        payload: { reason, filters }
      })
    ),

  listExports: ({ limit }) => db.withClient((c) => model.listExports(c, { limit }))
});
