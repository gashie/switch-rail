import { sendOk } from '../../core/http.js';

export const createSwiftController = ({ service }) => ({
  inbound: async (req, res) => {
    const result = await service.inbound(req.body, req.params.kind);
    sendOk(res, result, result.deduped ? 200 : 201);
  },
  outbound: async (req, res) => {
    const text = service.outbound({ envelope: req.body, kind: req.params.kind });
    sendOk(res, { kind: req.params.kind, text });
  }
});
