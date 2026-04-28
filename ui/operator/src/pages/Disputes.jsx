import { useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  PageHeader, Tabs, Card, Table, FiltersBar, Pagination,
  StatusBadge, Money, Button, Modal, Input, Textarea, Select,
  EmptyState, formatDate, truncateHash, showToast
} from '@sika/shared';
import {
  useListDisputesQuery,
  useGetDisputeQuery,
  useAdjudicateMutation,
  useFastTrackInvokeMutation
} from '@sika/shared/api/slices';
import { Gavel } from 'lucide-react';

const STATE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'EVIDENCE_PENDING', label: 'Evidence pending' },
  { value: 'ADJUDICATING', label: 'Adjudicating' },
  { value: 'UPHELD', label: 'Upheld' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'AUTO_RESOLVED', label: 'Auto-resolved' }
];

const REASON_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'FRAUD', label: 'Fraud' },
  { value: 'UNAUTHORIZED', label: 'Unauthorized' },
  { value: 'DUPLICATE', label: 'Duplicate' },
  { value: 'GOODS_NOT_RECEIVED', label: 'Goods not received' }
];

const Cases = () => {
  const dispatch = useDispatch();
  const [filters, setFilters] = useState({ q: '', state: '', reason: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [adj, setAdj] = useState(null);
  const [ruling, setRuling] = useState('UPHELD');
  const [adjReason, setAdjReason] = useState('');
  const { data, isLoading } = useListDisputesQuery({ ...filters, page, pageSize });
  const [adjudicate, { isLoading: judging }] = useAdjudicateMutation();
  const rows = data?.items || data?.rows || [];

  const onAdjudicate = async () => {
    try {
      await adjudicate({ id: adj.id, ruling, reason: adjReason }).unwrap();
      dispatch(showToast({ kind: 'success', message: `Dispute ruled ${ruling}` }));
      setAdj(null); setAdjReason(''); setRuling('UPHELD');
    } catch (e) {
      dispatch(showToast({ kind: 'error', message: e?.data?.error?.message || 'Adjudicate failed' }));
    }
  };

  return (
    <>
      <FiltersBar
        className="mb-4"
        filters={[
          { type: 'text', key: 'q', label: 'Search', placeholder: 'case id, tx id' },
          { type: 'select', key: 'state', label: 'State', options: STATE_OPTIONS },
          { type: 'select', key: 'reason', label: 'Reason', options: REASON_OPTIONS }
        ]}
        value={filters}
        onChange={setFilters}
        onApply={(next) => { setFilters(next); setPage(1); }}
      />

      <Card padding="none">
        <Table
          columns={[
            { key: 'id', label: 'Case', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
            { key: 'filed_at', label: 'Filed', render: (r) => formatDate(r.filed_at || r.created_at, 'PPpp') },
            { key: 'reason', label: 'Reason' },
            { key: 'transaction_id', label: 'Tx', render: (r) => <span className="font-mono">{truncateHash(r.transaction_id)}</span> },
            { key: 'amount_value', label: 'Amount', align: 'right',
              render: (r) => r.amount_value ? <Money valueMinor={r.amount_value} currency={r.amount_currency} /> : '—' },
            { key: 'sla_due_at', label: 'SLA due', render: (r) => r.sla_due_at ? formatDate(r.sla_due_at, 'PP') : '—' },
            { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> },
            {
              key: 'actions', label: '',
              render: (r) => ['ADJUDICATING', 'EVIDENCE_PENDING', 'OPEN'].includes(r.state)
                ? <Button size="sm" onClick={() => setAdj(r)}>Adjudicate</Button>
                : null
            }
          ]}
          rows={rows}
          rowKey="id"
          loading={isLoading}
          empty={<EmptyState icon={<Gavel className="w-8 h-8" />} title="No disputes" />}
        />
        <div className="px-3 border-t border-graphite-100">
          <Pagination total={data?.total || 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
        </div>
      </Card>

      <Modal
        open={!!adj}
        title="Adjudicate dispute"
        onClose={() => setAdj(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setAdj(null)}>Cancel</Button>
            <Button loading={judging} onClick={onAdjudicate}>Submit ruling</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select
            label="Ruling"
            value={ruling}
            onChange={(e) => setRuling(e.target.value)}
            options={[
              { value: 'UPHELD', label: 'Upheld (in favour of disputant)' },
              { value: 'PARTIAL_UPHELD', label: 'Partial uphold' },
              { value: 'DENIED', label: 'Denied' }
            ]}
          />
          <Textarea label="Reason / notes" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
        </div>
      </Modal>
    </>
  );
};

const FastTrack = () => {
  const dispatch = useDispatch();
  const [txId, setTxId] = useState('');
  const [reason, setReason] = useState('');
  const [invoke, { isLoading }] = useFastTrackInvokeMutation();

  const onInvoke = async (e) => {
    e.preventDefault();
    try {
      await invoke({ transactionId: txId, reason }).unwrap();
      dispatch(showToast({ kind: 'success', message: 'Fast-track reversal invoked' }));
      setTxId(''); setReason('');
    } catch (err) {
      dispatch(showToast({ kind: 'error', message: err?.data?.error?.message || 'Fast-track failed' }));
    }
  };

  return (
    <Card title="Invoke fast-track reversal">
      <p className="text-sm text-graphite-600 mb-3">
        For confirmed-fraud cases inside the 80-day window. The rail freezes
        the beneficiary, posts compensation, and writes
        <code className="mx-1">crossborder.fast_track_invoked</code>. Quota
        and SLA are enforced server-side.
      </p>
      <form className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end" onSubmit={onInvoke}>
        <Input label="Transaction id" value={txId} onChange={(e) => setTxId(e.target.value)} placeholder="019d…" />
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="confirmed fraud per case CASE-…" />
        <div className="md:col-span-2 flex justify-end">
          <Button type="submit" loading={isLoading}>Invoke fast-track</Button>
        </div>
      </form>
    </Card>
  );
};

export const Disputes = () => {
  const [tab, setTab] = useState('cases');
  return (
    <>
      <PageHeader
        title="Disputes"
        subtitle="Filed disputes, evidence collection, adjudication, fast-track reversal."
        breadcrumbs={[{ label: 'Operator' }, { label: 'Disputes' }]}
      />
      <Tabs
        className="mb-4"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'cases',     label: 'Cases' },
          { key: 'fasttrack', label: 'Fast-track' }
        ]}
      />
      {tab === 'cases' && <Cases />}
      {tab === 'fasttrack' && <FastTrack />}
    </>
  );
};

export default Disputes;
