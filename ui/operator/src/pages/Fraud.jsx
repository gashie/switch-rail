import { useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  PageHeader, Card, Tabs, Table, FiltersBar, Pagination,
  StatusBadge, Money, Button, Modal, EmptyState,
  formatDate, truncateHash, showToast
} from '@sika/shared';
import {
  useListFraudCasesQuery,
  useConfirmFraudCaseMutation,
  useListRulePackQuery,
  useListSanctionsHitsQuery
} from '@sika/shared/api/slices';
import { ShieldAlert } from 'lucide-react';

const STATE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'FROZEN', label: 'Frozen' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'RESOLVED', label: 'Resolved' }
];

const Cases = () => {
  const dispatch = useDispatch();
  const [filters, setFilters] = useState({ q: '', state: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const { data, isLoading } = useListFraudCasesQuery({ ...filters, page, pageSize });
  const [confirmCase, { isLoading: confirming }] = useConfirmFraudCaseMutation();
  const rows = data?.items || data?.rows || [];

  const onConfirm = async () => {
    try {
      await confirmCase({ id: selected.id, reason: reason || 'OPERATOR_CONFIRMED' }).unwrap();
      dispatch(showToast({ kind: 'success', message: 'Fraud case confirmed' }));
      setSelected(null);
      setReason('');
    } catch (e) {
      dispatch(showToast({ kind: 'error', message: e?.data?.error?.message || 'Confirm failed' }));
    }
  };

  return (
    <>
      <FiltersBar
        className="mb-4"
        filters={[
          { type: 'text', key: 'q', label: 'Search', placeholder: 'case id, account, alias' },
          { type: 'select', key: 'state', label: 'State', options: STATE_OPTIONS }
        ]}
        value={filters}
        onChange={setFilters}
        onApply={(next) => { setFilters(next); setPage(1); }}
      />

      <Card padding="none">
        <Table
          columns={[
            { key: 'id', label: 'Case', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
            { key: 'detected_at', label: 'Detected', render: (r) => formatDate(r.detected_at || r.created_at, 'PPpp') },
            { key: 'rule_id', label: 'Rule' },
            { key: 'subject', label: 'Subject', render: (r) => `${r.subject_type || '—'}:${r.subject_value || ''}` },
            { key: 'amount', label: 'Amount', align: 'right', render: (r) => r.amount_value ? <Money valueMinor={r.amount_value} currency={r.amount_currency} /> : '—' },
            { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> },
            {
              key: 'actions', label: '',
              render: (r) => (r.state !== 'CONFIRMED' && r.state !== 'RESOLVED' ? (
                <Button size="sm" variant="danger" onClick={() => setSelected(r)}>Confirm</Button>
              ) : null)
            }
          ]}
          rows={rows}
          rowKey="id"
          loading={isLoading}
          empty={<EmptyState icon={<ShieldAlert className="w-8 h-8" />} title="No fraud cases" description="Adjust filters or wait for the engine to flag." />}
        />
        <div className="px-3 border-t border-graphite-100">
          <Pagination
            total={data?.total || 0}
            page={page} pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          />
        </div>
      </Card>

      <Modal
        open={!!selected}
        title="Confirm fraud case"
        onClose={() => setSelected(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
            <Button variant="danger" loading={confirming} onClick={onConfirm}>Confirm fraud</Button>
          </>
        }
      >
        <p className="text-sm text-graphite-700">
          Confirms the case → CONFIRMED, posts compensation if liquidity hold
          is in place, writes audit (<code>fraud.confirmed</code>).
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

const Rules = () => {
  const { data, isLoading } = useListRulePackQuery();
  const rows = data?.items || data?.rules || data?.rows || [];
  return (
    <Card padding="none">
      <Table
        columns={[
          { key: 'rule_id', label: 'ID' },
          { key: 'name', label: 'Name' },
          { key: 'severity', label: 'Severity' },
          { key: 'enabled', label: 'Enabled', render: (r) => <StatusBadge status={r.enabled === false ? 'SUSPENDED' : 'ACTIVE'} size="sm" /> },
          { key: 'description', label: 'Description' }
        ]}
        rows={rows}
        rowKey="rule_id"
        loading={isLoading}
        empty={<EmptyState title="Rule pack empty" description="No rules currently loaded." />}
      />
    </Card>
  );
};

const Sanctions = () => {
  const { data, isLoading } = useListSanctionsHitsQuery({});
  const rows = data?.items || data?.rows || [];
  return (
    <Card padding="none">
      <Table
        columns={[
          { key: 'id', label: 'Hit', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
          { key: 'created_at', label: 'When', render: (r) => formatDate(r.created_at, 'PPpp') },
          { key: 'list_name', label: 'List' },
          { key: 'subject', label: 'Subject', render: (r) => r.subject || `${r.subject_type}:${r.subject_value}` },
          { key: 'score', label: 'Score', align: 'right' },
          { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> }
        ]}
        rows={rows}
        rowKey="id"
        loading={isLoading}
        empty={<EmptyState title="No sanctions hits" description="Screening produced no matches in this window." />}
      />
    </Card>
  );
};

export const Fraud = () => {
  const [tab, setTab] = useState('cases');
  return (
    <>
      <PageHeader
        title="Fraud"
        subtitle="Cases, rules, and sanctions screening hits."
        breadcrumbs={[{ label: 'Operator' }, { label: 'Fraud' }]}
      />
      <Tabs
        className="mb-4"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'cases', label: 'Cases' },
          { key: 'rules', label: 'Rule pack' },
          { key: 'sanctions', label: 'Sanctions' }
        ]}
      />
      {tab === 'cases' && <Cases />}
      {tab === 'rules' && <Rules />}
      {tab === 'sanctions' && <Sanctions />}
    </>
  );
};

export default Fraud;
