// Default per-participant daily and monthly caps in MINOR units of GHS
// (so 1,000,000 GHS = 100,000,000 minor). Caps may be overridden via the
// participant's `metadata.dailyCapMinor` / `metadata.monthlyCapMinor` fields,
// surfaced into ctx by the orchestrator.
export const DEFAULT_DAILY_CAP_MINOR = 100_000_000n;
export const DEFAULT_MONTHLY_CAP_MINOR = 3_000_000_000n;

/**
 * Limits check.
 *
 * Sums existing originator-direction outbound volume in the last 24h /
 * 30d, plus the current transaction's amount, and checks against the
 * participant's caps. Volume sums (`dailyVolumeMinor`, `monthlyVolumeMinor`)
 * and caps (`dailyCapMinor`, `monthlyCapMinor`) are pre-fetched into ctx
 * by the orchestrator. Returns `TRANSACTION_FORBIDDEN` (AG01) if either
 * window cap is breached.
 */
export const limits = ({
  transaction,
  dailyVolumeMinor = 0n,
  monthlyVolumeMinor = 0n,
  dailyCapMinor = DEFAULT_DAILY_CAP_MINOR,
  monthlyCapMinor = DEFAULT_MONTHLY_CAP_MINOR
}) => {
  const amount = BigInt(transaction.amount_value);
  const projectedDaily = BigInt(dailyVolumeMinor) + amount;
  const projectedMonthly = BigInt(monthlyVolumeMinor) + amount;
  if (projectedDaily > BigInt(dailyCapMinor)) {
    return {
      pass: false,
      code: 'TRANSACTION_FORBIDDEN',
      message: `daily cap exceeded: would push originator to ${projectedDaily} (cap ${dailyCapMinor})`
    };
  }
  if (projectedMonthly > BigInt(monthlyCapMinor)) {
    return {
      pass: false,
      code: 'TRANSACTION_FORBIDDEN',
      message: `monthly cap exceeded: would push originator to ${projectedMonthly} (cap ${monthlyCapMinor})`
    };
  }
  return { pass: true };
};
