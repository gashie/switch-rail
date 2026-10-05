import { buildXml, compactObject, minorToDecimal, ISO20022_NAMESPACES } from './xml.js';

export const formatCamt056Xml = (env) => {
  const decimal = minorToDecimal(env.amount.value, env.amount.currency);
  const meta = env.metadata || {};
  const obj = {
    Document: compactObject({
      '@xmlns': ISO20022_NAMESPACES.camt056,
      FIToFIPmtCxlReq: {
        Assgnmt: {
          Id: env.sourceMessageId || env.envelopeId,
          CreDtTm: env.createdAt
        },
        Undrlyg: {
          TxInf: {
            CxlId: env.envelopeId,
            OrgnlEndToEndId: env.endToEndId,
            OrgnlUETR: env.endToEndId,
            OrgnlIntrBkSttlmAmt: { '@Ccy': env.amount.currency, '#text': decimal },
            CxlRsnInf:
              meta.cancellationReasonCode || meta.cancellationReasonText
                ? {
                    Rsn: meta.cancellationReasonCode
                      ? { Cd: meta.cancellationReasonCode }
                      : undefined,
                    AddtlInf: meta.cancellationReasonText
                  }
                : undefined,
            OrgnlTxRef: {
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
      }
    })
  };
  return buildXml(obj);
};
