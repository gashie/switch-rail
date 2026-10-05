import { buildXml, compactObject, minorToDecimal, ISO20022_NAMESPACES } from './xml.js';

export const formatPacs007Xml = (env) => {
  const decimal = minorToDecimal(env.amount.value, env.amount.currency);
  const meta = env.metadata || {};
  const obj = {
    Document: compactObject({
      '@xmlns': ISO20022_NAMESPACES.pacs007,
      FIToFIPmtRvsl: {
        GrpHdr: {
          MsgId: env.sourceMessageId || env.envelopeId,
          CreDtTm: env.createdAt,
          NbOfTxs: '1'
        },
        TxInf: {
          RvslId: env.envelopeId,
          OrgnlEndToEndId: env.endToEndId,
          OrgnlUETR: env.endToEndId,
          RvsdIntrBkSttlmAmt: { '@Ccy': env.amount.currency, '#text': decimal },
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
          RvslRsnInf:
            meta.reversalReasonCode || meta.reversalReasonText
              ? {
                  Rsn: meta.reversalReasonCode ? { Cd: meta.reversalReasonCode } : undefined,
                  AddtlInf: meta.reversalReasonText
                }
              : undefined
        }
      }
    })
  };
  return buildXml(obj);
};
