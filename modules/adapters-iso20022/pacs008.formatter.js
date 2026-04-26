import { buildXml, compactObject, minorToDecimal, ISO20022_NAMESPACES } from './xml.js';

export const formatPacs008Xml = (env) => {
  const decimal = minorToDecimal(env.amount.value, env.amount.currency);
  const obj = {
    Document: compactObject({
      '@xmlns': ISO20022_NAMESPACES.pacs008,
      FIToFICstmrCdtTrf: {
        GrpHdr: {
          MsgId: env.sourceMessageId || env.envelopeId,
          CreDtTm: env.createdAt,
          NbOfTxs: '1',
          SttlmInf: env.settlementMethod ? { SttlmMtd: env.settlementMethod } : undefined
        },
        CdtTrfTxInf: {
          PmtId: {
            EndToEndId: env.endToEndId,
            UETR: env.endToEndId
          },
          IntrBkSttlmAmt: { '@Ccy': env.amount.currency, '#text': decimal },
          IntrBkSttlmDt: env.settlementDate,
          ChrgBr: env.fee?.bearer || 'DEBT',
          Dbtr: {
            Nm: env.originator.name,
            PstlAdr: env.originator.countryCode ? { Ctry: env.originator.countryCode } : undefined
          },
          DbtrAcct: { Id: { Othr: { Id: env.originator.accountId } } },
          DbtrAgt: env.originator.bic
            ? { FinInstnId: { BICFI: env.originator.bic } }
            : undefined,
          CdtrAgt: env.beneficiary.bic
            ? { FinInstnId: { BICFI: env.beneficiary.bic } }
            : undefined,
          Cdtr: {
            Nm: env.beneficiary.name,
            PstlAdr: env.beneficiary.countryCode
              ? { Ctry: env.beneficiary.countryCode }
              : undefined
          },
          CdtrAcct: { Id: { Othr: { Id: env.beneficiary.accountId } } },
          Purp: env.purposeCode ? { Cd: env.purposeCode } : undefined,
          RmtInf:
            env.remittance || env.reference
              ? {
                  Ustrd: env.remittance,
                  Strd: env.reference ? { RfrdDocInf: { Nb: env.reference } } : undefined
                }
              : undefined
        }
      }
    })
  };
  return buildXml(obj);
};
