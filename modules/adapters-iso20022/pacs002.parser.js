import { createEnvelope } from '../envelope/index.js';
import { parseXml, get, text, decimalToMinor } from './xml.js';

export const parsePacs002Xml = (xml) => {
  const parsed = parseXml(xml);
  const root = get(parsed, 'Document.FIToFIPmtStsRpt');
  if (!root) throw new Error('not a pacs.002.001.16 message');
  const grpHdr = root.GrpHdr || {};
  const txInfArr = root.TxInfAndSts;
  const tx = Array.isArray(txInfArr) ? txInfArr[0] : txInfArr;
  if (!tx) throw new Error('pacs.002 missing TxInfAndSts');

  const ref = tx.OrgnlTxRef || {};
  const amtNode = ref.IntrBkSttlmAmt;
  const currency = amtNode ? String(amtNode['@Ccy']).toUpperCase() : 'GHS';
  const value = amtNode ? decimalToMinor(text(amtNode), currency) : '0';

  const dbtrBic = get(ref, 'DbtrAgt.FinInstnId.BICFI');
  const cdtrBic = get(ref, 'CdtrAgt.FinInstnId.BICFI');
  const endToEndId = get(tx, 'OrgnlUETR') || get(tx, 'OrgnlEndToEndId');
  const sourceMessageId = get(grpHdr, 'MsgId');

  return createEnvelope({
    msgType: 'PMT_STATUS',
    sourceFormat: 'ISO20022',
    sourceMessageId,
    endToEndId,
    idempotencyKey: `iso20022:pacs002:${sourceMessageId}:${endToEndId}`,
    originator: {
      participantCode: dbtrBic ? dbtrBic.slice(0, 8) : 'UNKNOWN',
      accountId: get(ref, 'DbtrAcct.Id.Othr.Id') || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: get(ref, 'Dbtr.Nm') || 'UNKNOWN',
      bic: dbtrBic
    },
    beneficiary: {
      participantCode: cdtrBic ? cdtrBic.slice(0, 8) : 'UNKNOWN',
      accountId: get(ref, 'CdtrAcct.Id.Othr.Id') || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: get(ref, 'Cdtr.Nm') || 'UNKNOWN',
      bic: cdtrBic
    },
    amount: { value, currency },
    metadata: {
      txStatus: get(tx, 'TxSts'),
      reasonCode: get(tx, 'StsRsnInf.Rsn.Cd'),
      reasonText: get(tx, 'StsRsnInf.AddtlInf')
    }
  });
};
