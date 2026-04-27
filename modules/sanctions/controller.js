import { sendOk } from '../../core/http.js';

export const createSanctionsController = ({ service }) => ({
  listEntries: async (req, res) => {
    const entries = await service.listEntries(req.query);
    sendOk(res, { entries });
  },

  upsertEntry: async (req, res) => {
    const entry = await service.upsertEntry(req.body);
    sendOk(res, { entry }, 201);
  },

  removeEntry: async (req, res) => {
    const out = await service.removeEntry(req.params.id);
    sendOk(res, out);
  },

  screen: async (req, res) => {
    const result = await service.screen(req.body);
    sendOk(res, result);
  }
});
