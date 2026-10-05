import { sendOk } from '../../core/http.js';

export const createEscrowController = ({ service }) => ({
  create: async (req, res) => {
    const r = await service.create(req.body);
    sendOk(res, { escrow: r }, 201);
  },
  list: async (req, res) => {
    const items = await service.list(req.query);
    sendOk(res, { items });
  },
  getByNumber: async (req, res) => {
    const r = await service.findByNumber(req.params.escrowNumber);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, escrow: r });
  },
  sign: async (req, res) => {
    const userId = req.ctx?.user?.id || null;
    const r = await service.sign({
      escrowNumber: req.params.escrowNumber,
      signedBy: req.body.signedBy,
      signedByUser: userId
    });
    sendOk(res, { escrow: r });
  },
  payerRelease: async (req, res) => {
    const userId = req.ctx?.user?.id || null;
    const r = await service.payerRelease({
      escrowNumber: req.params.escrowNumber,
      releasedByUser: userId
    });
    sendOk(res, { escrow: r });
  },
  arbiterRelease: async (req, res) => {
    const r = await service.arbiterRelease({
      escrowNumber: req.params.escrowNumber,
      arbiterUserId: req.body.arbiterUserId,
      reason: req.body.reason
    });
    sendOk(res, { escrow: r });
  },
  refund: async (req, res) => {
    const r = await service.refund({
      escrowNumber: req.params.escrowNumber,
      reason: req.body.reason
    });
    sendOk(res, { escrow: r });
  },
  cancel: async (req, res) => {
    const r = await service.cancel({
      escrowNumber: req.params.escrowNumber,
      reason: req.body?.reason
    });
    sendOk(res, { escrow: r });
  },
  tick: async (_req, res) => {
    const out = await service.tick();
    sendOk(res, out);
  }
});
