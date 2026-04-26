import { buildXml, compactObject, minorToDecimal, ISO20022_NAMESPACES } from './xml.js';

export const formatPacs002Xml = (env) => {
  const decimal = minorToDecimal(env.amount.value, env.amount.currency);
  const meta = env.metadata || {};
  const obj = {
    Document: compactObject({
      '@xmlns': ISO20022_NAMESPACES.pacs002,
      FIToFIPmtStsRpt: {
        GrpHdr: {
          MsgId: env.sourceMessageId || env.envelopeId,
          CreDtTm: env.createdAt
        },
        TxInfAndSts: {
          OrgnlEndToEndId: env.endToEndId,
          OrgnlUETR: env.endToEndId,
          TxSts: meta.txStatus || 'ACSC',
          StsRsnInf:
            meta.reasonCode || meta.reasonText
              ? {
                  Rsn: meta.reasonCode ? { Cd: meta.reasonCode } : undefined,
                  AddtlInf: meta.reasonText
                }
              : undefined,
          OrgnlTxRef: {
            IntrBkSttlmAmt: { '@Ccy': env.amount.currency, '#text': decimal },
            Dbtr: { Nm: env.originator.name },
            DbtrAcct: { Id: { Othr: { Id: env.originator.accountId } } },
            DbtrAgt: env.originator.bic
              ? { FinInstnId: { BICFI: env.originator.bic } }
              : undefined,
            Cdtr: { Nm: env.beneficiary.name },
            CdtrAcct: { Id: { Othr: { Id: env.beneficiary.accountId } } },
            CdtrAgt: env.beneficiary.bic
              ? { FinInstnId: { BICFI: env.beneficiary.bic } }
              : undefined
          }
        }
      }
    })
  };
  return buildXml(obj);
};
