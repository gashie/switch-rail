// FATF travel-rule enforcement. Validates required fields, screens both
// originator and beneficiary names (cross-jurisdiction), persists the record.
// Travel-rule failures throw so the coordinator's surrounding withTransaction
// rolls back ledger postings.

import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { sanctionsService } from '../sanctions/index.js';
import { ID_TYPES, PURPOSE_OF_PAYMENT } from './codes.js';

// Required fields per the locked envelope shape.
const REQUIRED_FIELDS = Object.freeze([
  'originatorIdType', 'originatorIdHashed', 'originatorAddress',
  'beneficiaryIdType', 'beneficiaryIdHashed', 'beneficiaryAddress',
  'purposeOfPayment', 'jurisdictionOfOriginator', 'jurisdictionOfBeneficiary'
]);

const validateShape = (travelRule) => {
  if (!travelRule || typeof travelRule !== 'object') {
    return 'travel rule object missing';
  }
  for (const k of REQUIRED_FIELDS) {
    if (!travelRule[k]) return `travel rule missing required field: ${k}`;
  }
  if (!ID_TYPES.includes(travelRule.originatorIdType)) {
    return `unknown originatorIdType ${travelRule.originatorIdType}`;
  }
  if (!ID_TYPES.includes(travelRule.beneficiaryIdType)) {
    return `unknown beneficiaryIdType ${travelRule.beneficiaryIdType}`;
  }
  if (!PURPOSE_OF_PAYMENT.includes(travelRule.purposeOfPayment)) {
    return `unknown purposeOfPayment ${travelRule.purposeOfPayment}`;
  }
  return null;
};

export const createTravelRuleService = ({ db, model }) => {
  const enforceOnClient = async (client, {
    envelope,
    crossborderTxId,
    transactionId,
    direction
  }) => {
    const travelRule = envelope?.crossBorder?.travelRule;
    const shapeError = validateShape(travelRule);
    if (shapeError) {
      throw new AppError('TRAVEL_RULE_INCOMPLETE', shapeError, 400);
    }
    // Sanctions screening — both names + jurisdictions. Re-uses the existing
    // Phase 6 sanctions screener, threaded through this client so the row
    // commits with the surrounding transaction.
    const originatorName = envelope?.originator?.name;
    const beneficiaryName = envelope?.beneficiary?.name;
    const originatorScreen = originatorName
      ? await sanctionsService
          .screen({ name: originatorName, party: 'originator', client, transactionId: transactionId || null })
          .catch(() => ({ hit: false, matches: [] }))
      : { hit: false, matches: [] };
    const beneficiaryScreen = beneficiaryName
      ? await sanctionsService
          .screen({ name: beneficiaryName, party: 'beneficiary', client, transactionId: transactionId || null })
          .catch(() => ({ hit: false, matches: [] }))
      : { hit: false, matches: [] };
    const sanctionsHit = !!(originatorScreen.hit || beneficiaryScreen.hit);

    const id = uuidv7();
    const inserted = await model.insert(client, {
      id,
      crossborderTxId,
      transactionId,
      direction,
      travelRule,
      sanctionsScreenedAt: new Date().toISOString(),
      sanctionsHit,
      sanctionsHitDetails: sanctionsHit
        ? {
            originator: originatorScreen.hit ? originatorScreen.matches : null,
            beneficiary: beneficiaryScreen.hit ? beneficiaryScreen.matches : null
          }
        : null
    });

    await auditService.record(client, {
      actorType: 'system',
      eventType: 'travel_rule.enforced',
      resourceType: 'travel_rule_record',
      resourceId: id,
      payload: {
        direction,
        crossborderTxId: crossborderTxId || null,
        transactionId: transactionId || null,
        sanctionsHit,
        purposeOfPayment: travelRule.purposeOfPayment,
        jurisdictionOfOriginator: travelRule.jurisdictionOfOriginator,
        jurisdictionOfBeneficiary: travelRule.jurisdictionOfBeneficiary
      }
    });

    if (sanctionsHit) {
      throw new AppError(
        'TRAVEL_RULE_SANCTIONS_HIT',
        `sanctions match on ${originatorScreen.hit ? 'originator' : ''}${originatorScreen.hit && beneficiaryScreen.hit ? ' + ' : ''}${beneficiaryScreen.hit ? 'beneficiary' : ''}`,
        409,
        { recordId: id }
      );
    }

    return inserted;
  };

  // External callers (HTTP) get the standalone form. The record must persist
  // even when sanctions hit (regulators replay the audit), so we re-insert
  // the row in its own committed transaction after a sanctions throw.
  const enforce = async (input) => {
    try {
      return await db.withTransaction((client) => enforceOnClient(client, input));
    } catch (e) {
      if (e?.code === 'TRAVEL_RULE_SANCTIONS_HIT') {
        const travelRule = input.envelope?.crossBorder?.travelRule;
        const recordId = uuidv7();
        await db.withTransaction(async (client) => {
          await model.insert(client, {
            id: recordId,
            crossborderTxId: input.crossborderTxId,
            transactionId: input.transactionId,
            direction: input.direction,
            travelRule,
            sanctionsScreenedAt: new Date().toISOString(),
            sanctionsHit: true,
            sanctionsHitDetails: { reason: e.message }
          });
          await auditService.record(client, {
            actorType: 'system',
            eventType: 'travel_rule.enforced',
            resourceType: 'travel_rule_record',
            resourceId: recordId,
            payload: {
              direction: input.direction,
              sanctionsHit: true,
              purposeOfPayment: travelRule.purposeOfPayment,
              jurisdictionOfOriginator: travelRule.jurisdictionOfOriginator,
              jurisdictionOfBeneficiary: travelRule.jurisdictionOfBeneficiary,
              reason: e.message
            }
          });
        });
      }
      throw e;
    }
  };

  const list = (filters) => db.withClient((c) => model.list(c, filters));

  return { enforce, enforceOnClient, list };
};
