import { createEnvelope } from '../envelope/index.js';
import { parseXml, get, text, decimalToMinor } from '../adapters-iso20022/index.js';

export const parsePain001 = (xml, { batchId } = {}) => {
  const parsed = parseXml(xml);
  const root = get(parsed, 'Document.CstmrCdtTrfInitn');
  if (!root) throw new Error('not a pain.001 message');
  const grpHdr = root.GrpHdr || {};
  const sourceMessageId = grpHdr.MsgId;
  const ourBatchId = batchId || `pain001:${sourceMessageId}`;

  const pmtInfArr = Array.isArray(root.PmtInf) ? root.PmtInf : [root.PmtInf];

  const envelopes = [];
  let rowIndex = 0;
  for (const pmtInf of pmtInfArr) {
    if (!pmtInf) continue;
    const dbtrName = get(pmtInf, 'Dbtr.Nm');
    const dbtrAccountId =
      get(pmtInf, 'DbtrAcct.Id.IBAN') || get(pmtInf, 'DbtrAcct.Id.Othr.Id');
    const dbtrBic = get(pmtInf, 'DbtrAgt.FinInstnId.BICFI');

    const txArr = Array.isArray(pmtInf.CdtTrfTxInf)
      ? pmtInf.CdtTrfTxInf
      : pmtInf.CdtTrfTxInf
      ? [pmtInf.CdtTrfTxInf]
      : [];

    for (const tx of txArr) {
      rowIndex += 1;
      const amtNode = tx.Amt?.InstdAmt;
      const currency = String(amtNode['@Ccy']).toUpperCase();
      const value = decimalToMinor(text(amtNode), currency);

      const cdtrBic = get(tx, 'CdtrAgt.FinInstnId.BICFI');
      const cdtrAccountId =
        get(tx, 'CdtrAcct.Id.IBAN') || get(tx, 'CdtrAcct.Id.Othr.Id');
      const endToEndId = get(tx, 'PmtId.EndToEndId') || `${ourBatchId}:${rowIndex}`;

      envelopes.push(
        createEnvelope({
          msgType: 'CRDT_TRF',
          sourceFormat: 'BULK_PAIN001',
          sourceMessageId,
          endToEndId,
          idempotencyKey: `bulk:${ourBatchId}:${rowIndex}`,
          originator: {
            participantCode: dbtrBic ? dbtrBic.slice(0, 8) : 'UNKNOWN',
            accountId: dbtrAccountId || 'UNKNOWN',
            accountType: 'BANK_ACCOUNT',
            name: dbtrName || 'UNKNOWN',
            bic: dbtrBic
          },
          beneficiary: {
            participantCode: cdtrBic ? cdtrBic.slice(0, 8) : 'UNKNOWN',
            accountId: cdtrAccountId || 'UNKNOWN',
            accountType: 'BANK_ACCOUNT',
            name: get(tx, 'Cdtr.Nm') || 'UNKNOWN',
            bic: cdtrBic
          },
          amount: { value, currency },
          remittance: typeof get(tx, 'RmtInf.Ustrd') === 'string' ? get(tx, 'RmtInf.Ustrd') : undefined
        })
      );
    }
  }
  return envelopes;
};
