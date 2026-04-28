import Joi from 'joi';

const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);

// quote-and-instruct convenience body — most participant integrations call
// this single endpoint to ingest an XB envelope built externally.
export const ingestBodySchema = Joi.object({
  envelope: Joi.object().unknown(true).required()
});

export const idParamSchema = Joi.object({
  id: uuidRule.required()
});

export const txIdParamSchema = Joi.object({
  txId: uuidRule.required()
});
