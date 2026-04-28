import { sendOk } from '../../core/http.js';

export const createOpsDashboardController = ({ service }) => ({
  list: async (req, res) => {
    const rows = await service.listSnapshots(req.query);
    sendOk(res, { rows, total: rows.length });
  },
  record: async (req, res) => {
    const row = await service.recordSnapshot(req.body);
    sendOk(res, { snapshot: row }, 201);
  },
  summary: async (req, res) => {
    const out = await service.summary(req.query);
    sendOk(res, out);
  }
});
