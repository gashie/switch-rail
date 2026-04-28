import { sendOk } from '../../core/http.js';

export const createTravelRuleController = ({ service }) => ({
  enforce: async (req, res) => {
    const r = await service.enforce({
      direction: req.body.direction,
      crossborderTxId: req.body.crossborderTxId,
      transactionId: req.body.transactionId,
      envelope: {
        originator: { name: req.body.originatorName },
        beneficiary: { name: req.body.beneficiaryName },
        crossBorder: { travelRule: req.body.travelRule }
      }
    });
    sendOk(res, { record: r }, 201);
  },
  list: async (req, res) => {
    const items = await service.list(req.query);
    sendOk(res, { items });
  }
});
