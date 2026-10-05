import { sendOk } from '../../core/http.js';

export const createRefundsController = ({ service }) => ({
  initiate: async (req, res) => {
    const out = await service.initiate(req.body);
    sendOk(res, out, 201);
  },
  list: async (req, res) => {
    const items = await service.list(req.query);
    sendOk(res, { items });
  },
  listForOriginal: async (req, res) => {
    const items = await service.listForOriginal(req.params.originalTxId);
    sendOk(res, { items });
  },
  getByNumber: async (req, res) => {
    const r = await service.findByNumber(req.params.refundNumber);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, refund: r });
  },
  verifySignature: async (req, res) => {
    const r = await service.findByNumber(req.params.refundNumber);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    const payload = await service.linkSignaturePayload(r.id);
    sendOk(res, payload);
  }
});
