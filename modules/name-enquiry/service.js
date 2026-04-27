import { AppError } from '../../core/errors.js';
import { maskName } from '../../core/strings.js';
import { auditService } from '../audit/index.js';
import { directoryService } from '../directory/index.js';
import { aliasesService } from '../aliases/index.js';
import { participantsService } from '../participants/index.js';

const auditLookup = (client, input, outcome) =>
  auditService.record(client, {
    actorType: 'system',
    eventType: 'name_enquiry.executed',
    resourceType: 'account',
    resourceId: outcome.found ? outcome.accountId : null,
    payload: {
      inputShape: input.aliasType
        ? 'alias'
        : input.bic
        ? 'bic'
        : input.participantCode
        ? 'account'
        : 'unknown',
      participantCode: outcome.found ? outcome.participantCode : null,
      found: outcome.found
    }
  });

// Mask the canonical (normalized, uppercased) name so the same account
// returns the same mask regardless of the casing used at registration time.
const accountToOutcome = (account) => ({
  found: true,
  accountId: account.id,
  participantCode: account.participant_code,
  accountNumber: account.account_number,
  accountType: account.account_type,
  maskedName: maskName(account.account_name_normalized),
  currency: account.currency,
  status: account.status
});

export const createNameEnquiryService = ({ db }) => ({
  resolve: async ({ input }) => {
    if (!input || typeof input !== 'object') {
      throw new AppError('VALIDATION_FAILED', 'input must be an object', 400);
    }
    let found = null;

    if (input.aliasType && input.aliasValue) {
      const alias = await aliasesService.resolve({
        aliasType: input.aliasType,
        aliasValue: input.aliasValue
      });
      if (alias) {
        const account = await directoryService.findById(alias.account_id);
        if (account && account.status === 'active') found = account;
      }
    } else if (input.participantCode && input.accountNumber) {
      const account = await directoryService
        .findByAccount({
          participantCode: input.participantCode,
          accountNumber: input.accountNumber
        })
        .catch(() => null);
      if (account && account.status === 'active') found = account;
    } else if (input.bic && input.accountNumber) {
      const code = await participantsService.findByBic(input.bic);
      if (code) {
        const account = await directoryService
          .findByAccount({ participantCode: code, accountNumber: input.accountNumber })
          .catch(() => null);
        if (account && account.status === 'active') found = account;
      }
    } else {
      throw new AppError(
        'VALIDATION_FAILED',
        'input must be one of {aliasType,aliasValue} | {participantCode,accountNumber} | {bic,accountNumber}',
        400
      );
    }

    const outcome = found ? accountToOutcome(found) : { found: false };
    await db.withTransaction((client) => auditLookup(client, input, outcome));
    return outcome;
  },

  // Internal helper used by Confirmation of Payee in B3.8 — the same
  // resolution path, but returns the raw account row (with the full canonical
  // name) so CoP can score against it. Skips the audit row (CoP writes its
  // own).
  resolveAccount: async ({ input }) => {
    if (input.aliasType && input.aliasValue) {
      const alias = await aliasesService.resolve({
        aliasType: input.aliasType,
        aliasValue: input.aliasValue
      });
      if (!alias) return null;
      const account = await directoryService.findById(alias.account_id);
      return account && account.status === 'active' ? account : null;
    }
    if (input.participantCode && input.accountNumber) {
      const account = await directoryService
        .findByAccount({
          participantCode: input.participantCode,
          accountNumber: input.accountNumber
        })
        .catch(() => null);
      return account && account.status === 'active' ? account : null;
    }
    if (input.bic && input.accountNumber) {
      const code = await participantsService.findByBic(input.bic);
      if (!code) return null;
      const account = await directoryService
        .findByAccount({ participantCode: code, accountNumber: input.accountNumber })
        .catch(() => null);
      return account && account.status === 'active' ? account : null;
    }
    return null;
  }
});
