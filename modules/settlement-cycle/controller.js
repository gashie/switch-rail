import { sendOk } from '../../core/http.js';

export const createCycleController = ({ service, runner }) => ({
  list: async (req, res) => {
    const cycles = await service.list(req.query);
    sendOk(res, { cycles });
  },

  getById: async (req, res) => {
    const out = await service.findById(req.params.id);
    if (!out) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, cycle: out.cycle, movements: out.movements });
  },

  create: async (req, res) => {
    const operatorId = req.ctx?.user?.id || null;
    const cycle = await service.create({
      ...req.body,
      triggeredBy: operatorId ? `operator:${operatorId}` : 'scheduler',
      triggeredReason: req.body.reason
    });
    sendOk(res, { cycle }, 201);
  },

  run: async (req, res) => {
    const result = await runner.runCycle(req.params.id, { confirmation: req.body.confirmation });
    sendOk(res, result);
  }
});
