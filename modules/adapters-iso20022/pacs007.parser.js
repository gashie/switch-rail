import { createEnvelope } from '../envelope/index.js';
import { parseXml, get, text, decimalToMinor } from './xml.js';

export const parsePacs007Xml = (xml) => {
  const parsed = parseXml(xml);
  const root = get(parsed, 'Document.FIToFIPmtRvsl');
  if (!root) throw new Error('not a pacs.007.001.14 message');
  const grpHdr = root.GrpHdr || {};
  const txInfArr = root.TxInf;
  const tx = Array.isArray(txInfArr) ? txInfArr[0] : txInfArr;
  if (!tx) throw new Error('pacs.007 missing TxInf');

  const amtNode = tx.RvsdIntrBkSttlmAmt;
  const currency = String(amtNode['@Ccy']).toUpperCase();
  const value = decimalToMinor(text(amtNode), currency);

  const dbtrBic = get(tx, 'DbtrAgt.FinInstnId.BICFI');
  const cdtrBic = get(tx, 'CdtrAgt.FinInstnId.BICFI');
  const endToEndId = get(tx, 'OrgnlUETR') || get(tx, 'OrgnlEndToEndId');
  const sourceMessageId = get(grpHdr, 'MsgId');

  return createEnvelope({
    msgType: 'PMT_REVERSAL',
    sourceFormat: 'ISO20022',
    sourceMessageId,
    endToEndId,
    idempotencyKey: `iso20022:pacs007:${sourceMessageId}:${endToEndId}`,
    originator: {
      participantCode: dbtrBic ? dbtrBic.slice(0, 8) : 'UNKNOWN',
      accountId: get(tx, 'DbtrAcct.Id.Othr.Id') || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: get(tx, 'Dbtr.Nm') || 'UNKNOWN',
      bic: dbtrBic
    },
    beneficiary: {
      participantCode: cdtrBic ? cdtrBic.slice(0, 8) : 'UNKNOWN',
      accountId: get(tx, 'CdtrAcct.Id.Othr.Id') || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: get(tx, 'Cdtr.Nm') || 'UNKNOWN',
      bic: cdtrBic
    },
    amount: { value, currency },
    metadata: {
      reversalReasonCode: get(tx, 'RvslRsnInf.Rsn.Cd'),
      reversalReasonText: get(tx, 'RvslRsnInf.AddtlInf')
    }
  });
};
