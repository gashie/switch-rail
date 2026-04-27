// The RuleContext is the single shape every rule runner sees. Built once
// per authorization in a single SQL round-trip so the rules layer stays
// inside its 25ms p95 budget.

const oneRoundTripVelocity = async (client, { participantCode, accountId }) => {
  // Single query that emits 4 windows (1h/6h/24h/7d) plus distinct
  // beneficiary counts for the longer windows. The compound index
  // (originator_participant, originator_account, created_at) carries this.
  const r = await client.query(
    `SELECT
       count(*) FILTER (WHERE created_at >= now() - interval '1 hour')::int   AS c_1h,
       COALESCE(SUM(amount_value) FILTER (WHERE created_at >= now() - interval '1 hour'), 0)::text  AS s_1h,
       count(*) FILTER (WHERE created_at >= now() - interval '6 hours')::int  AS c_6h,
       COALESCE(SUM(amount_value) FILTER (WHERE created_at >= now() - interval '6 hours'), 0)::text AS s_6h,
       count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS c_24h,
       COALESCE(SUM(amount_value) FILTER (WHERE created_at >= now() - interval '24 hours'), 0)::text AS s_24h,
       count(DISTINCT (beneficiary_participant || ':' || beneficiary_account))
         FILTER (WHERE created_at >= now() - interval '24 hours')::int AS d_24h,
       count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int   AS c_7d,
       COALESCE(SUM(amount_value) FILTER (WHERE created_at >= now() - interval '7 days'), 0)::text  AS s_7d,
       count(DISTINCT (beneficiary_participant || ':' || beneficiary_account))
         FILTER (WHERE created_at >= now() - interval '7 days')::int AS d_7d
     FROM transactions
     WHERE originator_participant = $1
       AND originator_account = $2
       AND state IN ('AUTHORIZED','ROUTED','CREDIT_LEG_PENDING','CONFIRMED','PENDING_RECONCILIATION','REVERSED')`,
    [participantCode, accountId]
  );
  const row = r.rows[0] || {};
  return {
    last1h:  { count: row.c_1h ?? 0, sumMinor: row.s_1h ?? '0' },
    last6h:  { count: row.c_6h ?? 0, sumMinor: row.s_6h ?? '0' },
    last24h: {
      count: row.c_24h ?? 0,
      sumMinor: row.s_24h ?? '0',
      distinctBeneficiaries: row.d_24h ?? 0
    },
    last7d:  {
      count: row.c_7d ?? 0,
      sumMinor: row.s_7d ?? '0',
      distinctBeneficiaries: row.d_7d ?? 0
    }
  };
};

const isFirstTimeBeneficiaryQuery = async (client, { transaction }) => {
  const r = await client.query(
    `SELECT
       MIN(created_at) AS first_seen,
       count(*)::int AS prior_count
     FROM transactions
     WHERE originator_participant = $1
       AND originator_account = $2
       AND beneficiary_participant = $3
       AND beneficiary_account = $4
       AND id <> $5
       AND state IN ('AUTHORIZED','ROUTED','CREDIT_LEG_PENDING','CONFIRMED','PENDING_RECONCILIATION','REVERSED')`,
    [
      transaction.originator_participant,
      transaction.originator_account,
      transaction.beneficiary_participant,
      transaction.beneficiary_account,
      transaction.id
    ]
  );
  const row = r.rows[0];
  const firstSeen = row?.first_seen || null;
  const days = firstSeen ? Math.max(0, Math.floor((Date.now() - new Date(firstSeen).getTime()) / 86_400_000)) : 0;
  return {
    isFirstTime: (row?.prior_count ?? 0) === 0,
    daysSinceFirstSeen: days
  };
};

// Extension points:
//   - signals.{sanctionsHit, watchlistHit, networkGraphFlag, prevFlaggedByPeer}
//     are filled by B6.4-B6.6 wiring. B6.1 leaves them false.
//   - originator.baseline is filled by B6.2. B6.1 leaves it null.
//   - originator.accountAge is computed from the directory row.
const accountAgeDays = (account) => {
  if (!account?.created_at) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(account.created_at).getTime()) / 86_400_000));
};

export const createRuleContextBuilder = ({
  db,
  directoryService,
  baselineModel,
  alertsModel
}) => {
  const buildContext = async ({ transaction, envelope, client, signals: signalOverride }) => {
    const runOn = async (c) => {
      const [velocity, firstTime] = await Promise.all([
        oneRoundTripVelocity(c, {
          participantCode: transaction.originator_participant,
          accountId: transaction.originator_account
        }),
        isFirstTimeBeneficiaryQuery(c, { transaction })
      ]);

      // Account directory rows for accountAge — lookups via directoryService
      // so B6.1 doesn't need its own SQL. directoryService.findByAccount is
      // tolerant of missing rows.
      const [origAccount, beneAccount] = await Promise.all([
        directoryService
          .findByAccount({
            participantCode: transaction.originator_participant,
            accountNumber: transaction.originator_account
          })
          .catch(() => null),
        directoryService
          .findByAccount({
            participantCode: transaction.beneficiary_participant,
            accountNumber: transaction.beneficiary_account
          })
          .catch(() => null)
      ]);

      // Baseline lookup (B6.2). Falls back to null when not yet computed.
      let baseline = null;
      if (baselineModel && origAccount) {
        baseline = await baselineModel
          .findByAccountCurrency(c, origAccount.id, transaction.amount_currency)
          .catch(() => null);
      }

      // Network-graph signal (B6.5): is the beneficiary involved in any
      // confirmed mule-ring alert?
      let networkGraphFlag = false;
      if (alertsModel) {
        const beneKey = `${transaction.beneficiary_participant}:${transaction.beneficiary_account}`;
        networkGraphFlag = await alertsModel
          .isAccountInConfirmedMuleRing(c, beneKey)
          .catch(() => false);
      }

      return {
        transaction,
        envelope: envelope || null,
        originator: {
          account: origAccount,
          participant: transaction.originator_participant,
          accountAgeDays: accountAgeDays(origAccount),
          baseline
        },
        beneficiary: {
          account: beneAccount,
          participant: transaction.beneficiary_participant,
          isFirstTime: firstTime.isFirstTime,
          daysSinceFirstSeen: firstTime.daysSinceFirstSeen,
          accountAgeDays: accountAgeDays(beneAccount)
        },
        velocity,
        signals: {
          sanctionsHit: false,
          watchlistHit: false,
          networkGraphFlag,
          prevFlaggedByPeer: false,
          peerFlagSeverity: 0,
          ...signalOverride
        },
        device: {}
      };
    };
    if (client && typeof client.query === 'function') return runOn(client);
    return db.withClient(runOn);
  };

  return { buildContext };
};
