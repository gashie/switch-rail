import { uuidv7 } from '../../core/uuid.js';
import { canonicalJsonBytes } from '../../core/json.js';
import { AppError } from '../../core/errors.js';
import { cryptoKeysService } from '../crypto-keys/index.js';

const findRailKid = async () => {
  const keys = await cryptoKeysService.listActive({ ownerType: 'rail', ownerId: null });
  if (keys.length === 0) {
    throw new AppError('CONFLICT', 'no active rail signing key — statements cannot be issued', 503);
  }
  return keys[0].kid;
};

// Compose the canonical statement payload, sign it, and persist it. Runs
// inside the caller's withTransaction (the EOD cutover) so signature, db
// row, and day-state transition commit together.
export const issueStatement = async (
  client,
  {
    model,
    operatingDay,
    participantCode,
    currency,
    openingPositionMinor,
    totalCreditsMinor,
    totalDebitsMinor,
    totalFeesMinor,
    cycleCount,
    netSettledMinor,
    closingPositionMinor
  }
) => {
  const issuedAt = new Date().toISOString();
  const operatingDate =
    operatingDay.operating_date instanceof Date
      ? operatingDay.operating_date.toISOString().slice(0, 10)
      : operatingDay.operating_date;
  const payload = {
    schemaVersion: '1.0',
    operatingDayId: operatingDay.id,
    operatingDate,
    participantCode,
    currency,
    openingPositionMinor: String(openingPositionMinor),
    totalCreditsMinor: String(totalCreditsMinor),
    totalDebitsMinor: String(totalDebitsMinor),
    totalFeesMinor: String(totalFeesMinor),
    cycleCount: Number(cycleCount),
    netSettledMinor: String(netSettledMinor),
    closingPositionMinor: String(closingPositionMinor),
    issuedAt
  };
  const railKid = await findRailKid();
  const sig = await cryptoKeysService.sign({
    kid: railKid,
    payload: canonicalJsonBytes(payload)
  });
  const inserted = await model.insertStatement(client, {
    id: uuidv7(),
    operatingDayId: operatingDay.id,
    operatingDate,
    participantCode,
    currency,
    openingPositionMinor,
    totalCreditsMinor,
    totalDebitsMinor,
    totalFeesMinor,
    cycleCount: Number(cycleCount),
    netSettledMinor,
    closingPositionMinor,
    payload,
    signatureB64: sig.signature,
    signatureKid: sig.kid,
    signatureAlg: sig.alg
  });
  // ON CONFLICT may have skipped — return the existing row so the cutover
  // is idempotent on retry.
  return inserted ?? (await model.findStatement(client, operatingDate, participantCode, currency));
};
