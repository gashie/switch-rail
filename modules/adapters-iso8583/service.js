import { AppError } from '../../core/errors.js';
import { parse8583 } from './parser.js';
import { format8583 } from './formatter.js';

export const createIso8583Service = ({ envelope }) => ({
  inbound: async (buf, version = '1987') => {
    let parsed;
    try {
      parsed = parse8583(buf, version);
    } catch (e) {
      throw new AppError('VALIDATION_FAILED', `iso8583 parse failed: ${e.message}`, 400);
    }
    return envelope.ingest(parsed);
  },
  outbound: ({ envelope: env, version = '1987', mti }) => format8583(env, version, mti)
});
