import { sendOk } from '../../core/http.js';

export const createDecisionController = ({ decisionService }) => ({
  decide: async (req, res) => {
    const operatorId = req.ctx?.user?.id || null;
    const result = await decisionService.decideManually({
      caseNumber: req.params.caseNumber,
      outcome: req.body.outcome,
      rationaleCode: req.body.rationaleCode,
      rationaleNotes: req.body.rationaleNotes,
      outcomeAmountMinor: req.body.outcomeAmountMinor,
      decidedByUser: operatorId
    });
    sendOk(res, result, 201);
  },

  getDecision: async (req, res) => {
    const out = await decisionService.findByCase(req.params.caseNumber);
    if (!out) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, decision: out });
  }
});
