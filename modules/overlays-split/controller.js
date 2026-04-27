import { sendOk } from '../../core/http.js';

export const createSplitController = ({ service }) => ({
  create: async (req, res) => {
    const out = await service.create(req.body);
    sendOk(res, out, 201);
  },
  list: async (req, res) => {
    const items = await service.list(req.query);
    sendOk(res, { items });
  },
  getByNumber: async (req, res) => {
    const r = await service.findByNumber(req.params.splitNumber);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, split: r });
  },
  listLegs: async (req, res) => {
    const r = await service.findByNumber(req.params.splitNumber);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    const items = await service.listLegs(r.id);
    sendOk(res, { items });
  }
});
