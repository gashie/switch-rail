import { sendOk } from '../../core/http.js';

export const createRegulatorConsoleController = ({ service }) => ({
  digest: async (req, res) => {
    const out = await service.dailyDigest({ day: req.query.day });
    sendOk(res, out);
  },

  logExport: async (req, res) => {
    const event = await service.logExport({
      reason: req.body.reason,
      resourceType: req.body.resourceType,
      filters: req.body.filters || {},
      actorId: req.ctx?.user?.id || null
    });
    sendOk(res, { event }, 201);
  },

  listExports: async (req, res) => {
    const rows = await service.listExports({ limit: 100 });
    sendOk(res, { rows });
  }
});
