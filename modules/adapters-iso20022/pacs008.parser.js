import { createEnvelope } from '../envelope/index.js';
import { parseXml, get, text, decimalToMinor } from './xml.js';

export const parsePacs008Xml = (xml) => {
  const parsed = parseXml(xml);
  const root = get(parsed, 'Document.FIToFICstmrCdtTrf');
  if (!root) throw new Error('not a pacs.008.001.14 message');
  const grpHdr = root.GrpHdr || {};
  const txArr = root.CdtTrfTxInf;
  const tx = Array.isArray(txArr) ? txArr[0] : txArr;
  if (!tx) throw new Error('pacs.008 missing CdtTrfTxInf');

  const amtNode = tx.IntrBkSttlmAmt;
  const currency = String(amtNode['@Ccy']).toUpperCase();
  const value = decimalToMinor(text(amtNode), currency);

  const dbtrBic = get(tx, 'DbtrAgt.FinInstnId.BICFI');
  const cdtrBic = get(tx, 'CdtrAgt.FinInstnId.BICFI');
  const dbtrAccountId =
    get(tx, 'DbtrAcct.Id.IBAN') || get(tx, 'DbtrAcct.Id.Othr.Id');
  const cdtrAccountId =
    get(tx, 'CdtrAcct.Id.IBAN') || get(tx, 'CdtrAcct.Id.Othr.Id');
  const endToEndId = get(tx, 'PmtId.UETR') || get(tx, 'PmtId.EndToEndId');
  const sourceMessageId = get(grpHdr, 'MsgId');

  const remittance = get(tx, 'RmtInf.Ustrd');
  const reference = get(tx, 'RmtInf.Strd.RfrdDocInf.Nb');

  return createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'ISO20022',
    sourceMessageId,
    endToEndId,
    idempotencyKey: `iso20022:pacs008:${sourceMessageId}:${endToEndId}`,
    originator: {
      participantCode: dbtrBic ? dbtrBic.slice(0, 8) : 'UNKNOWN',
      accountId: dbtrAccountId || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: get(tx, 'Dbtr.Nm') || 'UNKNOWN',
      bic: dbtrBic,
      countryCode: get(tx, 'Dbtr.PstlAdr.Ctry')
    },
    beneficiary: {
      participantCode: cdtrBic ? cdtrBic.slice(0, 8) : 'UNKNOWN',
      accountId: cdtrAccountId || 'UNKNOWN',
      accountType: 'BANK_ACCOUNT',
      name: get(tx, 'Cdtr.Nm') || 'UNKNOWN',
      bic: cdtrBic,
      countryCode: get(tx, 'Cdtr.PstlAdr.Ctry')
    },
    amount: { value, currency },
    purposeCode: get(tx, 'Purp.Cd'),
    settlementMethod: get(grpHdr, 'SttlmInf.SttlmMtd'),
    settlementDate: get(tx, 'IntrBkSttlmDt'),
    remittance: typeof remittance === 'string' ? remittance : undefined,
    reference
  });
};
