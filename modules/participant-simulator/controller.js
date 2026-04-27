import { AppError } from '../../core/errors.js';
import { sendOk } from '../../core/http.js';

// The simulator implements the *participant* HTTP contract, not the rail's
// API envelope, so it must emit `{ok, data}` / `{ok, error}` at the top
// level (NOT wrapped inside another `data`). Success paths therefore call
// sendOk with just the inner payload; failure paths throw a 200-status
// AppError so errorHandler emits the canonical `{ok:false, error}` body
// at HTTP 200, matching what a real bank's credit-leg endpoint returns.
const passthroughError = (body) =>
  new AppError(
    body.error?.code || 'XT99',
    body.error?.message || 'unknown',
    200
  );

export const createSimulatorController = ({ service }) => ({
  creditLeg: async (req, res) => {
    const { participantCode } = req.params;
    const result = await service.creditLeg({ participantCode, request: req.body });
    if (result.kind === 'tcp_error') {
      // Simulate an unreachable participant by tearing down the connection.
      req.socket?.destroy();
      return;
    }
    if (result.body?.ok === false) {
      throw passthroughError(result.body);
    }
    sendOk(res, result.body?.data ?? {}, 200);
  },

  statusCheck: async (req, res) => {
    const { participantCode } = req.params;
    const out = await service.statusCheck({ participantCode, request: req.body });
    sendOk(res, out.data);
  },

  reversal: async (_req, res) => {
    const out = await service.reversal();
    sendOk(res, out.data);
  },

  upsertOverride: async (req, res) => {
    const row = await service.upsertOverride(req.body);
    sendOk(res, { override: row }, 201);
  },

  listOverrides: async (req, res) => {
    const overrides = await service.listOverrides({ participantCode: req.query.participantCode });
    sendOk(res, { overrides });
  }
});
