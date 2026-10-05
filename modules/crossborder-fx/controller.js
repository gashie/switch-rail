import { sendOk } from '../../core/http.js';

export const createFxController = ({ service }) => ({
  quote: async (req, res) => {
    const r = await service.quote(req.body);
    sendOk(res, { quote: r }, 201);
  },
  getById: async (req, res) => {
    const r = await service.findById(req.params.id);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, quote: r });
  },
  lock: async (req, res) => {
    const r = await service.lock(req.params.id);
    sendOk(res, { quote: r });
  },
  expirePastDue: async (_req, res) => {
    const out = await service.expirePastDue();
    sendOk(res, out);
  },
  registerMaker: async (req, res) => {
    const r = await service.registerMaker(req.body);
    sendOk(res, { maker: r }, 201);
  },
  listMakers: async (_req, res) => {
    const items = await service.listMakers();
    sendOk(res, { items });
  }
});
