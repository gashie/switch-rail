import { buildXml, compactObject, minorToDecimal, ISO20022_NAMESPACES } from './xml.js';

export const formatPacs004Xml = (env) => {
  const decimal = minorToDecimal(env.amount.value, env.amount.currency);
  const meta = env.metadata || {};
  const obj = {
    Document: compactObject({
      '@xmlns': ISO20022_NAMESPACES.pacs004,
      PmtRtr: {
        GrpHdr: {
          MsgId: env.sourceMessageId || env.envelopeId,
          CreDtTm: env.createdAt,
          NbOfTxs: '1'
        },
        TxInf: {
          RtrId: env.envelopeId,
          OrgnlEndToEndId: env.endToEndId,
          OrgnlUETR: env.endToEndId,
          RtrdIntrBkSttlmAmt: { '@Ccy': env.amount.currency, '#text': decimal },
          Dbtr: { Nm: env.originator.name },
          DbtrAcct: { Id: { Othr: { Id: env.originator.accountId } } },
          DbtrAgt: env.originator.bic
            ? { FinInstnId: { BICFI: env.originator.bic } }
            : undefined,
          Cdtr: { Nm: env.beneficiary.name },
          CdtrAcct: { Id: { Othr: { Id: env.beneficiary.accountId } } },
          CdtrAgt: env.beneficiary.bic
            ? { FinInstnId: { BICFI: env.beneficiary.bic } }
            : undefined,
          RtrRsnInf:
            meta.returnReasonCode || meta.returnReasonText
              ? {
                  Rsn: meta.returnReasonCode ? { Cd: meta.returnReasonCode } : undefined,
                  AddtlInf: meta.returnReasonText
                }
              : undefined
        }
      }
    })
  };
  return buildXml(obj);
};
