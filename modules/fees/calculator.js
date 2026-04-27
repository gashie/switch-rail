// Pure fee calculation. Given a schedule row + amount, returns the fee in
// minor units (BigInt). No DB access, no side effects.

import { AppError } from '../../core/errors.js';

const applyMinMax = (fee, minFee, maxFee) => {
  let out = fee;
  if (out < minFee) out = minFee;
  if (maxFee != null && out > maxFee) out = maxFee;
  return out;
};

export const calculateFromSchedule = (schedule, amountMinor) => {
  if (!schedule) return { feeMinor: 0n, breakdown: { applied: false, reason: 'no schedule' } };
  const amount = BigInt(amountMinor);
  const minFee = BigInt(schedule.min_fee_minor || 0);
  const maxFee = schedule.max_fee_minor != null ? BigInt(schedule.max_fee_minor) : null;

  if (schedule.fee_type === 'FLAT') {
    const fee = applyMinMax(BigInt(schedule.flat_minor), minFee, maxFee);
    return { feeMinor: fee, breakdown: { type: 'FLAT', flat: fee.toString() } };
  }
  if (schedule.fee_type === 'PERCENTAGE') {
    const bps = BigInt(schedule.pct_bps);
    // basis points: amount * bps / 10000
    const raw = (amount * bps) / 10000n;
    const fee = applyMinMax(raw, minFee, maxFee);
    return {
      feeMinor: fee,
      breakdown: { type: 'PERCENTAGE', bps: schedule.pct_bps, raw: raw.toString(), applied: fee.toString() }
    };
  }
  if (schedule.fee_type === 'TIERED') {
    const tiers = Array.isArray(schedule.tiers) ? schedule.tiers : [];
    let tier = null;
    for (const t of tiers) {
      const from = BigInt(t.fromMinor);
      const to = t.toMinor != null ? BigInt(t.toMinor) : null;
      if (amount >= from && (to == null || amount <= to)) {
        tier = t;
        break;
      }
    }
    if (!tier) {
      throw new AppError(
        'VALIDATION_FAILED',
        `no tier matched amount ${amount} in schedule ${schedule.schedule_code}`,
        400
      );
    }
    let raw;
    if (tier.feeMinor != null) {
      raw = BigInt(tier.feeMinor);
    } else if (tier.feeBps != null) {
      raw = (amount * BigInt(tier.feeBps)) / 10000n;
    } else {
      raw = 0n;
    }
    const fee = applyMinMax(raw, minFee, maxFee);
    return {
      feeMinor: fee,
      breakdown: { type: 'TIERED', tier, raw: raw.toString(), applied: fee.toString() }
    };
  }
  throw new AppError('VALIDATION_FAILED', `unknown fee_type ${schedule.fee_type}`, 400);
};
