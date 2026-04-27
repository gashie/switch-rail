import { sendOk } from '../../core/http.js';

export const createGraphController = ({ edgesService, alertsService }) => ({
  edgesFor: async (req, res) => {
    const out = await edgesService.adjacency(req.params.accountKey);
    sendOk(res, out);
  },

  listAlerts: async (req, res) => {
    const alerts = await alertsService.list(req.query);
    sendOk(res, { alerts });
  },

  getAlert: async (req, res) => {
    const alert = await alertsService.findById(req.params.id);
    if (!alert) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, alert });
  },

  resolveAlert: async (req, res) => {
    const updated = await alertsService.resolve({
      id: req.params.id,
      status: req.body.status,
      notes: req.body.notes,
      resolvedBy: req.ctx?.user?.id || null
    });
    sendOk(res, { alert: updated });
  },

  scan: async (req, res) => {
    const result = await alertsService.runScan({ windowHours: req.body?.windowHours ?? 24 });
    sendOk(res, result);
  }
});
