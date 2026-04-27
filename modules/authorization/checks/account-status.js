/**
 * Account-status check.
 *
 * Originator account must exist and be `active`. Beneficiary account must
 * exist and be `active`. Frozen → BENEFICIARY_ACCOUNT_BLOCKED. Closed →
 * BENEFICIARY_ACCOUNT_CLOSED. Missing → BENEFICIARY_ACCOUNT_NOT_FOUND. For
 * the originator side, missing/closed/frozen all surface as
 * INVALID_END_CUSTOMER (BE01) since they all mean "the rail does not have a
 * good originator on file".
 */
export const accountStatus = ({ originatorAccount, beneficiaryAccount }) => {
  if (!originatorAccount) {
    return {
      pass: false,
      code: 'INVALID_END_CUSTOMER',
      message: 'originator account not found in directory'
    };
  }
  if (originatorAccount.status !== 'active') {
    return {
      pass: false,
      code: 'INVALID_END_CUSTOMER',
      message: `originator account is ${originatorAccount.status}`
    };
  }
  if (!beneficiaryAccount) {
    return {
      pass: false,
      code: 'BENEFICIARY_ACCOUNT_NOT_FOUND',
      message: 'beneficiary account not found in directory'
    };
  }
  if (beneficiaryAccount.status === 'closed') {
    return {
      pass: false,
      code: 'BENEFICIARY_ACCOUNT_CLOSED',
      message: 'beneficiary account is closed'
    };
  }
  if (beneficiaryAccount.status === 'frozen') {
    return {
      pass: false,
      code: 'BENEFICIARY_ACCOUNT_BLOCKED',
      message: 'beneficiary account is frozen'
    };
  }
  if (beneficiaryAccount.status !== 'active') {
    return {
      pass: false,
      code: 'BENEFICIARY_ACCOUNT_BLOCKED',
      message: `beneficiary account is ${beneficiaryAccount.status}`
    };
  }
  return { pass: true };
};
