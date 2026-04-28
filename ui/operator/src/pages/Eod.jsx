import { useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  PageHeader, Tabs, Card, Table, Button, StatusBadge, Modal,
  EmptyState, formatDate, truncateHash, showToast, Input
} from '@sika/shared';
import {
  useListEodRunsQuery,
  useCutOverMutation,
  useListReconBreaksQuery
} from '@sika/shared/api/slices';

const Runs = () => {
  const dispatch = useDispatch();
  const { data, isLoading } = useListEodRunsQuery({});
  const [cutOpen, setCutOpen] = useState(false);
  const [token, setToken] = useState('');
  const [cutOver, { isLoading: cutting }] = useCutOverMutation();
  const rows = data?.items || data?.rows || [];

  const onCut = async () => {
    try {
      await cutOver({ confirmationToken: token }).unwrap();
      dispatch(showToast({ kind: 'success', message: 'EOD cutover requested' }));
      setCutOpen(false); setToken('');
    } catch (e) {
      dispatch(showToast({ kind: 'error', message: e?.data?.error?.message || 'Cutover failed' }));
    }
  };

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setCutOpen(true)}>Cut over to next operating day</Button>
      </div>
      <Card padding="none">
        <Table
          columns={[
            { key: 'id', label: 'Run', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
            { key: 'operating_date', label: 'Op. date' },
            { key: 'started_at', label: 'Started', render: (r) => r.started_at ? formatDate(r.started_at, 'PPpp') : '—' },
            { key: 'completed_at', label: 'Completed', render: (r) => r.completed_at ? formatDate(r.completed_at, 'PPpp') : '—' },
            { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> }
          ]}
          rows={rows}
          rowKey="id"
          loading={isLoading}
          empty={<EmptyState title="No EOD runs yet" />}
        />
      </Card>
      <Modal
        open={cutOpen}
        title="EOD cutover"
        onClose={() => setCutOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setCutOpen(false)}>Cancel</Button>
            <Button loading={cutting} onClick={onCut}>Cut over</Button>
          </>
        }
      >
        <p className="text-sm text-graphite-700">
          Cuts the operating day forward. Requires an authorised confirmation
          token (see CLAUDE.md — function-signature rule enforcement).
        </p>
        <div className="mt-3">
          <Input label="Confirmation token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="paste token" />
        </div>
      </Modal>
    </>
  );
};

const Recon = () => {
  const { data, isLoading } = useListReconBreaksQuery({});
  const rows = data?.items || data?.rows || [];
  return (
    <Card padding="none">
      <Table
        columns={[
          { key: 'id', label: 'Break', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
          { key: 'created_at', label: 'When', render: (r) => formatDate(r.created_at, 'PPpp') },
          { key: 'reason_code', label: 'Reason' },
          { key: 'subject', label: 'Subject', render: (r) => r.subject || `${r.subject_type}:${r.subject_value}` },
          { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> }
        ]}
        rows={rows}
        rowKey="id"
        loading={isLoading}
        empty={<EmptyState title="No recon breaks" description="Reconciliation produced no exceptions in this window." />}
      />
    </Card>
  );
};

export const Eod = () => {
  const [tab, setTab] = useState('runs');
  return (
    <>
      <PageHeader
        title="End-of-day"
        subtitle="EOD runs, cutover, and reconciliation breaks."
        breadcrumbs={[{ label: 'Operator' }, { label: 'EOD' }]}
      />
      <Tabs
        className="mb-4"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'runs',  label: 'Runs' },
          { key: 'recon', label: 'Recon breaks' }
        ]}
      />
      {tab === 'runs' && <Runs />}
      {tab === 'recon' && <Recon />}
    </>
  );
};

export default Eod;
