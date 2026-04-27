// r-wrong-beneficiary — auto-REJECT if there's evidence that the customer
// ran CoP against the beneficiary, got 'no-match', and proceeded anyway
// (i.e. overrode the warning). The rail logs every cop.executed call as
// an audit_event with payload.score; we look for one matching this
// (originator participant, beneficiary account) before the transaction
// was created with score == 'no-match'.

export const rWrongBeneficiary = async ({ transaction, client }) => {
  // Resolve the beneficiary account UUID — that's the resource_id in the
  // cop.executed audit row.
  const acct = await client.query(
    `SELECT id FROM accounts WHERE participant_code = $1 AND account_number = $2 LIMIT 1`,
    [transaction.beneficiary_participant, transaction.beneficiary_account]
  );
  if (acct.rows.length === 0) return { resolvable: false };
  const beneficiaryAccountId = acct.rows[0].id;

  const txCreatedAt = transaction.created_at instanceof Date
    ? transaction.created_at.toISOString()
    : transaction.created_at;

  const r = await client.query(
    `SELECT id, ts, payload
       FROM audit_events
      WHERE event_type = 'cop.executed'
        AND resource_id = $1
        AND payload->>'participantCode' = $2
        AND payload->>'score' = 'no-match'
        AND ts <= $3::timestamptz
      ORDER BY ts DESC LIMIT 1`,
    [beneficiaryAccountId, transaction.originator_participant, txCreatedAt]
  );
  if (r.rows.length === 0) return { resolvable: false };
  return {
    resolvable: true,
    outcome: 'REJECT',
    rationaleCode: 'AUTO_WRONG_BENEFICIARY_COP_OVERRIDE',
    notes: `customer ran CoP at ${r.rows[0].ts}, got no-match, proceeded anyway`
  };
};
