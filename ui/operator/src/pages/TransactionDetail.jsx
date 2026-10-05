import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import {
  PageHeader, Card, StatusBadge, Money, Timeline, Button, Modal,
  Tabs, Skeleton, formatDate
} from '@sika/shared';
import {
  useGetTransactionQuery,
  useListAuthEventsQuery,
  useForceRejectTransactionMutation
} from '@sika/shared/api/slices';
import { useDispatch } from 'react-redux';
import { showToast } from '@sika/shared';

export const TransactionDetail = () => {
  const { id } = useParams();
  const dispatch = useDispatch();
  const [tab, setTab] = useState('summary');
  const [killOpen, setKillOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { data, isLoading } = useGetTransactionQuery(id);
  const tx = data?.transaction || data;
  const { data: events } = useListAuthEventsQuery(id);
  const [forceReject, { isLoading: rejecting }] = useForceRejectTransactionMutation();

  const onKill = async () => {
    try {
      await forceReject({ id, reason: reason || 'OPERATOR_KILL_SWITCH' }).unwrap();
      dispatch(showToast({ kind: 'success', message: 'Transaction force-rejected' }));
      setKillOpen(false);
    } catch (e) {
      dispatch(showToast({ kind: 'error', message: e?.data?.error?.message || 'Force-reject failed' }));
    }
  };

  if (isLoading) {
    return (
      <Card>
        <Skeleton variant="text" width="40%" />
        <div className="mt-3"><Skeleton variant="card" /></div>
      </Card>
    );
  }
  if (!tx) {
    return (
      <Card>
        <p className="text-sm text-graphite-700">Transaction not found.</p>
        <Link className="text-emerald-700 text-sm" to="/transactions">Back to list</Link>
      </Card>
    );
  }

  const terminal = ['CONFIRMED', 'REJECTED', 'REVERSED', 'FAILED'].includes(tx.state);

  return (
    <>
      <PageHeader
        title={`Transaction ${tx.id?.slice(0, 8)}…`}
        breadcrumbs={[{ label: 'Operator' }, { label: 'Transactions', href: '/transactions' }, { label: tx.id?.slice(0, 8) }]}
        actions={
          !terminal && <Button variant="danger" onClick={() => setKillOpen(true)}>Force-reject</Button>
        }
      />

      <Tabs
        className="mb-4"
        tabs={[
          { key: 'summary', label: 'Summary' },
          { key: 'timeline', label: 'Timeline' },
          { key: 'raw', label: 'Raw' }
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'summary' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Money">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-graphite-500">Amount</dt>
              <dd className="text-right"><Money valueMinor={tx.amount_value} currency={tx.amount_currency} /></dd>
              <dt className="text-graphite-500">Fee</dt>
              <dd className="text-right"><Money valueMinor={tx.fee_minor || 0} currency={tx.amount_currency} /></dd>
              <dt className="text-graphite-500">State</dt>
              <dd className="text-right"><StatusBadge status={tx.state} /></dd>
              <dt className="text-graphite-500">Created</dt>
              <dd className="text-right">{formatDate(tx.created_at, 'PPpp')}</dd>
              <dt className="text-graphite-500">Confirmed</dt>
              <dd className="text-right">{tx.confirmed_at ? formatDate(tx.confirmed_at, 'PPpp') : '—'}</dd>
            </dl>
          </Card>
          <Card title="Parties">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-graphite-500">Originator</dt>
              <dd className="text-right">{tx.originator_participant}</dd>
              <dt className="text-graphite-500">Beneficiary</dt>
              <dd className="text-right">{tx.beneficiary_participant}</dd>
              <dt className="text-graphite-500">Rail class</dt>
              <dd className="text-right">{tx.rail_class || '—'}</dd>
              <dt className="text-graphite-500">End-to-end ID</dt>
              <dd className="text-right font-mono">{tx.end_to_end_id || '—'}</dd>
            </dl>
          </Card>
        </div>
      )}

      {tab === 'timeline' && (
        <Card title="Authorization & state events">
          <Timeline
            entries={(events?.history || events?.items || []).map((e) => ({
              at: e.occurred_at || e.created_at,
              by: e.occurred_by || e.actor || e.actor_type || 'system',
              label: e.to_state ? `${e.from_state || '∅'} → ${e.to_state}${e.reason_code ? ` (${e.reason_code})` : ''}` : (e.event_type || 'event'),
              payload: e.payload
            }))}
          />
        </Card>
      )}

      {tab === 'raw' && (
        <Card title="Raw record">
          <pre className="text-xs font-mono bg-graphite-50 border border-graphite-200 rounded p-3 overflow-auto">
            {JSON.stringify(tx, null, 2)}
          </pre>
        </Card>
      )}

      <Modal
        open={killOpen}
        title="Force-reject transaction"
        onClose={() => setKillOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setKillOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={rejecting} onClick={onKill}>Force-reject</Button>
          </>
        }
      >
        <p className="text-sm text-graphite-700">
          This calls the operator kill-switch. State {'→'} REJECTED with reason
          {' '}<code>OPERATOR_KILL_SWITCH</code>. Audit event written.
        </p>
        <textarea
          className="mt-3 w-full h-24 p-2 border border-graphite-300 rounded text-sm"
          placeholder="Reason (optional)…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
    </>
  );
};

export default TransactionDetail;
