import { sendOk } from '../../core/http.js';

export const createForeignRailsController = ({ service, simulator }) => ({
  register: async (req, res) => {
    const r = await service.register(req.body);
    sendOk(res, { rail: r }, 201);
  },
  list: async (req, res) => {
    const items = await service.list(req.query);
    sendOk(res, { items });
  },
  getByCode: async (req, res) => {
    const r = await service.findByCode(req.params.code);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, rail: r });
  },
  find: async (req, res) => {
    const items = await service.findForCountryCurrency(req.query);
    sendOk(res, { items });
  },
  setActive: async (req, res) => {
    const r = await service.setActive({
      railCode: req.params.code,
      active: !!req.body.active
    });
    sendOk(res, { rail: r });
  },

  // Simulator endpoints — emit the participant-side responses.
  simQuote: async (req, res) => {
    const out = simulator.quote(req.body);
    sendOk(res, out);
  },
  simInstruct: async (req, res) => {
    const out = simulator.instruct(req.body);
    sendOk(res, out, 201);
  },
  simStatus: async (req, res) => {
    const out = simulator.status(req.body);
    sendOk(res, out);
  },
  simFreeze: async (req, res) => {
    const out = simulator.freeze(req.body);
    sendOk(res, out);
  },
  simReverse: async (req, res) => {
    const out = simulator.reverse(req.body);
    sendOk(res, out);
  }
});
