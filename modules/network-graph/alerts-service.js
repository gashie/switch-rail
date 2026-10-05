import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import {
  scanMuleRings,
  scanStructuring,
  scanCoordinatedBurst
} from './scanner.js';

export const createAlertsService = ({ db, alertsModel, edgesModel }) => {
  const persistAlerts = async (client, candidates) => {
    const out = [];
    for (const c of candidates) {
      const inserted = await alertsModel.insertAlert(client, {
        id: uuidv7(),
        alertType: c.alertType,
        accountKeys: c.accountKeys,
        evidence: c.evidence,
        compositeScore: c.compositeScore
      });
      out.push(inserted);
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'network_graph.alert_raised',
        resourceType: 'graph_alert',
        resourceId: inserted.id,
        payload: {
          alertType: c.alertType,
          accountKeys: c.accountKeys,
          compositeScore: c.compositeScore
        }
      });
    }
    return out;
  };

  const runScan = async ({ windowHours = 24 } = {}) =>
    db.withTransaction(async (client) => {
      const [mules, structuring, bursts] = await Promise.all([
        scanMuleRings({ model: edgesModel, client, windowHours }),
        scanStructuring({ model: edgesModel, client, windowHours }),
        scanCoordinatedBurst({ model: edgesModel, client, windowMinutes: 30 })
      ]);
      const all = [...mules, ...structuring, ...bursts];
      return { alerts: await persistAlerts(client, all), counts: { mules: mules.length, structuring: structuring.length, bursts: bursts.length } };
    });

  const list = (filters) =>
    db.withClient((c) =>
      alertsModel.listAlerts(c, {
        alertType: filters.alertType || null,
        status: filters.status || null,
        limit: filters.limit ?? 100
      })
    );

  const findById = (id) => db.withClient((c) => alertsModel.findById(c, id));

  const resolve = ({ id, status, notes, resolvedBy }) =>
    db.withTransaction(async (client) => {
      const updated = await alertsModel.updateStatus(client, {
        id,
        status,
        resolvedBy,
        notes
      });
      await auditService.record(client, {
        actorType: resolvedBy ? 'user' : 'system',
        actorId: resolvedBy || null,
        eventType: 'network_graph.alert_resolved',
        resourceType: 'graph_alert',
        resourceId: id,
        payload: { status, notes: notes ?? null }
      });
      return updated;
    });

  const isAccountInConfirmedMuleRing = (accountKey) =>
    db.withClient((c) => alertsModel.isAccountInConfirmedMuleRing(c, accountKey));

  return { runScan, list, findById, resolve, isAccountInConfirmedMuleRing };
};
