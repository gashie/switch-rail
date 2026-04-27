import { AppError } from '../../core/errors.js';
import { parsePacs008Xml } from './pacs008.parser.js';
import { formatPacs008Xml } from './pacs008.formatter.js';
import { parsePacs002Xml } from './pacs002.parser.js';
import { formatPacs002Xml } from './pacs002.formatter.js';
import { parsePacs004Xml } from './pacs004.parser.js';
import { formatPacs004Xml } from './pacs004.formatter.js';
import { parsePacs007Xml } from './pacs007.parser.js';
import { formatPacs007Xml } from './pacs007.formatter.js';
import { parseCamt056Xml } from './camt056.parser.js';
import { formatCamt056Xml } from './camt056.formatter.js';

const FORMATTERS = Object.freeze({
  pacs008: formatPacs008Xml,
  pacs002: formatPacs002Xml,
  pacs004: formatPacs004Xml,
  pacs007: formatPacs007Xml,
  camt056: formatCamt056Xml
});

export const createIso20022Service = ({ envelope, orchestrator }) => {
  const ingest = async (xml, parser) => {
    let parsed;
    try {
      parsed = parser(String(xml));
    } catch (e) {
      throw new AppError('VALIDATION_FAILED', `iso20022 parse failed: ${e.message}`, 400);
    }
    return envelope.ingest(parsed);
  };

  // Phase-4 path: parse pacs.008 XML and run the full orchestrator. Returns
  // the transaction outcome alongside the parsed envelope so the caller can
  // observe state, response code, and reason without a second roundtrip.
  const process = async (xml) => {
    if (!orchestrator) throw new AppError('INTERNAL', 'iso20022 service constructed without orchestrator', 500);
    let parsed;
    try {
      parsed = parsePacs008Xml(String(xml));
    } catch (e) {
      throw new AppError('VALIDATION_FAILED', `iso20022 parse failed: ${e.message}`, 400);
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
  };

  return {
    inboundPacs008: (xml) => ingest(xml, parsePacs008Xml),
    inboundPacs002: (xml) => ingest(xml, parsePacs002Xml),
    inboundPacs004: (xml) => ingest(xml, parsePacs004Xml),
    inboundPacs007: (xml) => ingest(xml, parsePacs007Xml),
    inboundCamt056: (xml) => ingest(xml, parseCamt056Xml),
    process,
    outbound: ({ type, envelope: env }) => {
      const formatter = FORMATTERS[type];
      if (!formatter) {
        throw new AppError('VALIDATION_FAILED', `unknown iso20022 type: ${type}`, 400);
      }
      return formatter(env);
    }
  };
};
