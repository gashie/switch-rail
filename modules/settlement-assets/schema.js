import Joi from 'joi';
import { SETTLEMENT_ASSET_TYPES } from '../envelope/index.js';

const currency = Joi.string().length(3).uppercase();
const amountMinor = Joi.string().pattern(/^\d+$/);

export const settleBodySchema = Joi.object({
  assetType: Joi.string().valid(...SETTLEMENT_ASSET_TYPES).required(),
  payAmountMinor: amountMinor.required(),
  payCurrency: currency.required(),
  receiveAmountMinor: amountMinor.required(),
  receiveCurrency: currency.required(),
  foreignRailCode: Joi.string().pattern(/^[A-Z0-9_]{3,32}$/).required(),
  txId: Joi.string().pattern(/^[0-9a-f-]{36}$/i).optional()
});

export { SETTLEMENT_ASSET_TYPES };
