import { sendOk } from '../../core/http.js';

export const createSettlementController = ({ settlementService }) => ({
  confirmSettlement: async (req, res) => {
    const operatorId = req.ctx?.user?.id || null;
    const result = await settlementService.confirmSettlement({
      caseNumber: req.params.caseNumber,
      confirmedByUser: operatorId,
      notes: req.body?.notes
    });
    sendOk(res, result);
  },

  settleAutoResolved: async (req, res) => {
    const result = await settlementService.settleAutoResolved({
      caseNumber: req.params.caseNumber
    });
    sendOk(res, result);
  }
});
