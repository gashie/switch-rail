import { AppError } from '../../core/errors.js';
import { parse8583 } from './parser.js';
import { format8583 } from './formatter.js';

export const createIso8583Service = ({ envelope, orchestrator }) => ({
  inbound: async (buf, version = '1987') => {
    let parsed;
    try {
      parsed = parse8583(buf, version);
    } catch (e) {
      throw new AppError('VALIDATION_FAILED', `iso8583 parse failed: ${e.message}`, 400);
    }
    return envelope.ingest(parsed);
  },
  process: async (buf, version = '1987') => {
    if (!orchestrator) throw new AppError('INTERNAL', 'iso8583 service constructed without orchestrator', 500);
    let parsed;
    try {
      parsed = parse8583(buf, version);
    } catch (e) {
      throw new AppError('VALIDATION_FAILED', `iso8583 parse failed: ${e.message}`, 400);
    }
    const result = await orchestrator.process(parsed);
    return {
      envelope: parsed,
      transaction: result.transaction,
      transactionId: result.transaction.id,
      state: result.transaction.state,
      reasonCode: result.transaction.reason_code,
      responseCode: result.transaction.response_code,
      deduped: !!result.deduped,
      receipts: result.receipts || []
    };
  },
  outbound: ({ envelope: env, version = '1987', mti }) => format8583(env, version, mti)
});
