import { sendOk } from '../../core/http.js';

export const createMandatesController = ({ service, schedulerWorker }) => ({
  create: async (req, res) => {
    const r = await service.create(req.body);
    sendOk(res, { mandate: r }, 201);
  },
  list: async (req, res) => {
    const items = await service.list(req.query);
    sendOk(res, { items });
  },
  getByNumber: async (req, res) => {
    const r = await service.findByNumber(req.params.mandateNumber);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, mandate: r });
  },
  presentDebit: async (req, res) => {
    const m = await service.findByNumber(req.params.mandateNumber);
    if (!m) {
      sendOk(res, { found: false }, 404);
      return;
    }
    const out = await service.presentDebit({
      mandateId: m.id,
      presentedAmountMinor: req.body.presentedAmountMinor,
      presentedByActor: 'PAYEE_API'
    });
    sendOk(res, out, 201);
  },
  revoke: async (req, res) => {
    const r = await service.revoke({
      mandateNumber: req.params.mandateNumber,
      revokedBy: req.body.revokedBy,
      reason: req.body.reason
    });
    sendOk(res, { mandate: r });
  },
  pause: async (req, res) => {
    const r = await service.pause({
      mandateNumber: req.params.mandateNumber,
      reason: req.body.reason
    });
    sendOk(res, { mandate: r });
  },
  resume: async (req, res) => {
    const r = await service.resume({ mandateNumber: req.params.mandateNumber });
    sendOk(res, { mandate: r });
  },
  listDebits: async (req, res) => {
    const m = await service.findByNumber(req.params.mandateNumber);
    if (!m) {
      sendOk(res, { found: false }, 404);
      return;
    }
    const items = await service.listDebits(m.id, 200);
    sendOk(res, { items });
  },
  schedulerTick: async (_req, res) => {
    const out = await schedulerWorker.runOnce();
    sendOk(res, out);
  }
});
