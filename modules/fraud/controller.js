import { sendOk } from '../../core/http.js';

export const createFraudController = ({ rulesService, signalsService }) => ({
  listPacks: async (_req, res) => {
    const packs = await rulesService.listPacks();
    sendOk(res, { packs });
  },

  getPackByCode: async (req, res) => {
    const out = await rulesService.findPackByCode(req.params.code);
    if (!out) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, pack: out.pack, rules: out.rules });
  },

  getRule: async (req, res) => {
    const rule = await rulesService.findRule(req.params.id);
    if (!rule) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, rule });
  },

  proposeRuleChange: async (req, res) => {
    const operatorId = req.ctx?.user?.id || null;
    const updated = await rulesService.proposeChange({
      ruleId: req.params.id,
      pendingChange: req.body,
      proposedBy: operatorId
    });
    sendOk(res, { rule: updated }, 201);
  },

  approveRuleChange: async (req, res) => {
    const operatorId = req.ctx?.user?.id || null;
    const updated = await rulesService.approveChange({
      ruleId: req.params.id,
      approvedBy: operatorId
    });
    sendOk(res, { rule: updated });
  },

  signalsByTransaction: async (req, res) => {
    const signals = await signalsService.listByTransaction(req.params.txId);
    sendOk(res, { signals });
  }
});
