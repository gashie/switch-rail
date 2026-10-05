import { AppError } from '../../core/errors.js';
import { parseMT103, formatMT103 } from './mt103.js';
import { parseMT202, formatMT202 } from './mt202.js';
import { parseMT900, parseMT910 } from './mt900-910.js';

const PARSERS = Object.freeze({
  mt103: parseMT103,
  mt202: parseMT202,
  mt900: parseMT900,
  mt910: parseMT910
});

const FORMATTERS = Object.freeze({
  mt103: formatMT103,
  mt202: formatMT202
});

export const createSwiftService = ({ envelope }) => ({
  inbound: async (text, kind) => {
    const parser = PARSERS[String(kind).toLowerCase()];
    if (!parser) throw new AppError('VALIDATION_FAILED', `unknown SWIFT kind: ${kind}`, 400);
    let parsed;
    try {
      parsed = parser(String(text));
    } catch (e) {
      throw new AppError('VALIDATION_FAILED', `swift parse failed: ${e.message}`, 400);
    }
    return envelope.ingest(parsed);
  },
  outbound: ({ envelope: env, kind }) => {
    const formatter = FORMATTERS[String(kind).toLowerCase()];
    if (!formatter) {
      throw new AppError('VALIDATION_FAILED', `unsupported SWIFT outbound kind: ${kind}`, 400);
    }
    return formatter(env);
  }
});
