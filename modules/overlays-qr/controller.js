import { sendOk } from '../../core/http.js';

export const createQrController = ({ service }) => ({
  createStatic: async (req, res) => {
    const r = await service.createStatic(req.body);
    sendOk(res, { qr: r }, 201);
  },
  createDynamic: async (req, res) => {
    const r = await service.createDynamic(req.body);
    sendOk(res, { qr: r }, 201);
  },
  decode: async (req, res) => {
    const decoded = service.decode(req.body.encodedPayload);
    sendOk(res, decoded);
  },
  pay: async (req, res) => {
    const out = await service.pay(req.body);
    sendOk(res, out, 201);
  },
  revoke: async (req, res) => {
    const r = await service.revoke({ id: req.params.id });
    sendOk(res, { qr: r });
  },
  getById: async (req, res) => {
    const r = await service.findById(req.params.id);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, qr: r });
  }
});
