import { sendOk } from '../../core/http.js';

export const createReconController = ({ service }) => ({
  listRuns: async (req, res) => {
    const runs = await service.listRuns(req.query);
    sendOk(res, runs);
  },

  getRun: async (req, res) => {
    const out = await service.findRun(req.params.id);
    if (!out) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, run: out.run, breaks: out.breaks });
  },

  createRun: async (req, res) => {
    const out = await service.runReconciliation(req.body);
    sendOk(res, out, 201);
  },

  listBreaks: async (req, res) => {
    const breaks = await service.listBreaks(req.query);
    sendOk(res, { breaks });
  },

  resolve: async (req, res) => {
    const updated = await service.resolveBreak({
      id: req.params.id,
      resolution: req.body.resolution,
      notes: req.body.notes,
      resolvedBy: req.ctx?.user?.id || null
    });
    sendOk(res, updated);
  }
});
