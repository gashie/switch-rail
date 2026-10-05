import { sendOk } from '../../core/http.js';

export const createR2pController = ({ service }) => ({
  create: async (req, res) => {
    const r = await service.create(req.body);
    sendOk(res, { request: r }, 201);
  },

  list: async (req, res) => {
    const items = await service.list(req.query);
    sendOk(res, { items });
  },

  getByNumber: async (req, res) => {
    const r = await service.findByRequestNumber(req.params.requestNumber);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, request: r });
  },

  authorize: async (req, res) => {
    const userId = req.ctx?.user?.id || null;
    const out = await service.authorize({
      requestNumber: req.params.requestNumber,
      payerAccountNumber: req.body.payerAccountNumber,
      payerName: req.body.payerName,
      authorizedByUser: userId
    });
    sendOk(res, out, 201);
  },

  reject: async (req, res) => {
    const userId = req.ctx?.user?.id || null;
    const r = await service.reject({
      requestNumber: req.params.requestNumber,
      reason: req.body.reason,
      notes: req.body.notes,
      rejectedByUser: userId
    });
    sendOk(res, { request: r });
  },

  expirePending: async (_req, res) => {
    const out = await service.expirePending();
    sendOk(res, out);
  }
});
