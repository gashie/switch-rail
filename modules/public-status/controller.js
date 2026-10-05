import { sendOk } from '../../core/http.js';

export const createPublicStatusController = ({ service }) => ({
  // Public read endpoints — no auth.
  publicSummary: async (_req, res) => {
    const open = await service.listOpen();
    const recent = await service.listRecent({ limit: 10 });
    sendOk(res, {
      overall: open.length === 0 ? 'OPERATIONAL' : (
        open.some((i) => i.severity === 'CRITICAL') ? 'CRITICAL' :
        open.some((i) => i.severity === 'MAJOR')    ? 'MAJOR'    :
        open.some((i) => i.severity === 'MINOR')    ? 'MINOR'    : 'INFO'
      ),
      open,
      recent
    });
  },

  publicIncident: async (req, res) => {
    const updates = await service.listUpdates({ incidentId: req.params.id });
    sendOk(res, { updates });
  },

  verifyReceipt: async (req, res) => {
    const out = await service.verifyReceipt({ transactionId: req.body.transactionId });
    sendOk(res, out);
  },

  // Operator-only mutations
  declare: async (req, res) => {
    const incident = await service.declareIncident({
      ...req.body,
      declaredBy: req.ctx?.user?.id || 'operator'
    });
    sendOk(res, { incident }, 201);
  },

  update: async (req, res) => {
    const update = await service.postUpdate({
      incidentId: req.params.id,
      body: req.body.body,
      postedBy: req.ctx?.user?.id || 'operator'
    });
    sendOk(res, { update }, 201);
  },

  resolve: async (req, res) => {
    const incident = await service.resolveIncident({
      incidentId: req.params.id,
      closingNote: req.body.closingNote,
      postedBy: req.ctx?.user?.id || 'operator'
    });
    sendOk(res, { incident });
  }
});
