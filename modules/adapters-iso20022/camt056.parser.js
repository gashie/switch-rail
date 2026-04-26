import { createEnvelope } from '../envelope/index.js';
import { parseXml, get, text, decimalToMinor } from './xml.js';

export const parseCamt056Xml = (xml) => {
  const parsed = parseXml(xml);
  const root = get(parsed, 'Document.FIToFIPmtCxlReq');
  if (!root) throw new Error('not a camt.056.001.11 message');
  const assgnmt = root.Assgnmt || {};
  const undrlygArr = root.Undrlyg;
  const undrlyg = Array.isArray(undrlygArr) ? undrlygArr[0] : undrlygArr;
  const txInfArr = undrlyg ? undrlyg.TxInf : undefined;
  const tx = Array.isArray(txInfArr) ? txInfArr[0] : txInfArr;
  if (!tx) throw new Error('camt.056 missing Undrlyg/TxInf');

  const amtNode = tx.OrgnlIntrBkSttlmAmt;
  const currency = String(amtNode['@Ccy']).toUpperCase();
  const value = decimalToMinor(text(amtNode), currency);

  const dbtrBic = get(tx, 'OrgnlTxRef.DbtrAgt.FinInstnId.BICFI');
  const cdtrBic = get(tx, 'OrgnlTxRef.CdtrAgt.FinInstnId.BICFI');
  const endToEndId = get(tx, 'OrgnlUETR') || get(tx, 'OrgnlEndToEndId');
  const sourceMessageId = get(assgnmt, 'Id');

  return createEnvelope({
    msgType: 'PMT_REVERSAL',
    sourceFormat: 'ISO20022',
    sourceMessageId,
    endToEndId,
    idempotencyKey: `iso20022:camt056:${sourceMessageId}:${endToEndId}`,
    originator: {
      participantCode: dbtrBic ? dbtrBic.slice(0, 8) : 'UNKNOWN',
      accountId: get(tx, 'OrgnlTxRef.DbtrAcct.Id.Othr.Id') || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: get(tx, 'OrgnlTxRef.Dbtr.Nm') || 'UNKNOWN',
      bic: dbtrBic
    },
    beneficiary: {
      participantCode: cdtrBic ? cdtrBic.slice(0, 8) : 'UNKNOWN',
      accountId: get(tx, 'OrgnlTxRef.CdtrAcct.Id.Othr.Id') || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: get(tx, 'OrgnlTxRef.Cdtr.Nm') || 'UNKNOWN',
      bic: cdtrBic
    },
    amount: { value, currency },
    metadata: {
      cancellationReasonCode: get(tx, 'CxlRsnInf.Rsn.Cd'),
      cancellationReasonText: get(tx, 'CxlRsnInf.AddtlInf')
    }
  });
};
