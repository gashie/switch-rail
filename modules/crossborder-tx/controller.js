import { sendOk } from '../../core/http.js';
import { createEnvelope } from '../envelope/index.js';
import { transactionsOrchestrator } from '../transactions/index.js';

export const createCrossborderTxController = ({ service, recoveryWorker }) => ({
  ingest: async (req, res) => {
    // The body's `envelope` is the customer-supplied raw envelope JSON.
    // We re-validate via createEnvelope (catches travel-rule + FX timing),
    // then drive it through the orchestrator which delegates to the
    // coordinator on XB envelopes.
    const env = createEnvelope(req.body.envelope);
    const out = await transactionsOrchestrator.process(env);
    sendOk(res, out, 201);
  },

  getById: async (req, res) => {
    const r = await service.findById(req.params.id);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, crossborder: r });
  },

  getByTxId: async (req, res) => {
    const r = await service.findByTxId(req.params.txId);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, crossborder: r });
  },

  tick: async (_req, res) => {
    const out = await recoveryWorker.tick();
    sendOk(res, out);
  }
});
