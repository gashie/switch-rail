import { sendOk } from '../../core/http.js';

export const createCashoutController = ({ service }) => ({
  initiate: async (req, res) => {
    const r = await service.initiate(req.body);
    sendOk(res, { request: r }, 201);
  },
  list: async (req, res) => {
    const items = await service.list(req.query);
    sendOk(res, { items });
  },
  getByNumber: async (req, res) => {
    const r = await service.findByNumber(req.params.requestNumber);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    // Don't leak the OTP outside the initial response.
    const { agent_otp: _agentOtp, ...safe } = r;
    void _agentOtp;
    sendOk(res, { found: true, request: safe });
  },
  authorize: async (req, res) => {
    const userId = req.ctx?.user?.id || null;
    const r = await service.authorize({
      requestNumber: req.params.requestNumber,
      authorizedByUser: userId
    });
    sendOk(res, { request: r });
  },
  complete: async (req, res) => {
    const out = await service.complete({
      requestNumber: req.params.requestNumber,
      otp: req.body.otp,
      customerName: req.body.customerName
    });
    sendOk(res, out, 201);
  },
  cancel: async (req, res) => {
    const userId = req.ctx?.user?.id || null;
    const r = await service.cancel({
      requestNumber: req.params.requestNumber,
      cancelledBy: req.body.cancelledBy,
      reason: req.body.reason,
      cancelledByUser: userId
    });
    sendOk(res, { request: r });
  },
  expirePast: async (_req, res) => {
    const out = await service.expirePast();
    sendOk(res, out);
  }
});
