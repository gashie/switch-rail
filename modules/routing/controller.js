import { sendOk } from '../../core/http.js';

export const createRoutingController = ({ service }) => ({
  addRule: async (req, res) => {
    const result = await service.addRule(req.body);
    sendOk(res, result, 201);
  },

  removeRule: async (req, res) => {
    const result = await service.removeRule(req.params.id);
    sendOk(res, result);
  },

  listRules: async (req, res) => {
    const rules = await service.listRules(req.query);
    sendOk(res, { rules, version: service.stats().version });
  },

  reload: async (_req, res) => {
    const stats = await service.reload();
    sendOk(res, stats);
  },

  resolve: async (req, res) => {
    const r = await service.resolve(req.body);
    if (!r) {
      sendOk(res, { found: false });
      return;
    }
    sendOk(res, { found: true, ...r });
  }
});
