import { useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  PageHeader, Tabs, Card, Table, FiltersBar, Pagination, StatusBadge,
  Money, Button, Input, EmptyState, formatDate, truncateHash, showToast
} from '@sika/shared';
import {
  useListCrossborderQuery,
  useListForeignRailsQuery,
  useQuoteFxMutation,
  useListFxQuotesQuery,
  useListTravelRuleQuery
} from '@sika/shared/api/slices';
import { Globe2 } from 'lucide-react';

const STATE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'INITIATED', label: 'Initiated' },
  { value: 'FOREIGN_INSTRUCTING', label: 'Instructing foreign rail' },
  { value: 'PENDING_FOREIGN', label: 'Awaiting foreign rail' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'FAILED', label: 'Failed' }
];

const Txs = () => {
  const [filters, setFilters] = useState({ q: '', state: '', rail: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const { data, isLoading } = useListCrossborderQuery({ ...filters, page, pageSize });
  const rows = data?.items || data?.rows || [];
  return (
    <>
      <FiltersBar
        className="mb-4"
        filters={[
          { type: 'text', key: 'q', label: 'Search', placeholder: 'foreign tx id' },
          { type: 'select', key: 'state', label: 'State', options: STATE_OPTIONS },
          { type: 'text', key: 'rail', label: 'Foreign rail' }
        ]}
        value={filters}
        onChange={setFilters}
        onApply={(next) => { setFilters(next); setPage(1); }}
      />
      <Card padding="none">
        <Table
          columns={[
            { key: 'id', label: 'Cross-border', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
            { key: 'initiated_at', label: 'Initiated', render: (r) => formatDate(r.initiated_at, 'PPpp') },
            { key: 'foreign_rail_code', label: 'Rail' },
            { key: 'pay_amount_minor', label: 'Pay', align: 'right',
              render: (r) => <Money valueMinor={r.pay_amount_minor} currency={r.pay_currency} /> },
            { key: 'receive_amount_minor', label: 'Receive', align: 'right',
              render: (r) => <Money valueMinor={r.receive_amount_minor} currency={r.receive_currency} /> },
            { key: 'attempts', label: 'Attempts', align: 'right' },
            { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> }
          ]}
          rows={rows}
          rowKey="id"
          loading={isLoading}
          empty={<EmptyState icon={<Globe2 className="w-8 h-8" />} title="No cross-border txs" />}
        />
        <div className="px-3 border-t border-graphite-100">
          <Pagination total={data?.total || 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
        </div>
      </Card>
    </>
  );
};

const Rails = () => {
  const { data, isLoading } = useListForeignRailsQuery();
  const rows = data?.items || data?.rows || [];
  return (
    <Card padding="none">
      <Table
        columns={[
          { key: 'rail_code', label: 'Code' },
          { key: 'display_name', label: 'Name' },
          { key: 'iso_country', label: 'Country' },
          { key: 'currencies', label: 'Currencies', render: (r) => Array.isArray(r.currencies) ? r.currencies.join(', ') : (r.currency || '—') },
          { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state || 'ACTIVE'} /> }
        ]}
        rows={rows}
        rowKey="rail_code"
        loading={isLoading}
        empty={<EmptyState title="No foreign rails configured" />}
      />
    </Card>
  );
};

const Fx = () => {
  const dispatch = useDispatch();
  const [pay, setPay] = useState('GHS');
  const [recv, setRecv] = useState('USD');
  const [amt, setAmt] = useState('');
  const [quote, { isLoading }] = useQuoteFxMutation();
  const { data } = useListFxQuotesQuery({ limit: 10 });
  const quotes = data?.items || data?.rows || [];

  const onQuote = async (e) => {
    e.preventDefault();
    try {
      await quote({ payCurrency: pay, receiveCurrency: recv, payAmountMinor: amt }).unwrap();
      dispatch(showToast({ kind: 'success', message: 'FX quote requested' }));
      setAmt('');
    } catch (err) {
      dispatch(showToast({ kind: 'error', message: err?.data?.error?.message || 'Quote failed' }));
    }
  };

  return (
    <>
      <Card title="Request FX quote" className="mb-4">
        <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end" onSubmit={onQuote}>
          <Input label="Pay CCY" value={pay} onChange={(e) => setPay(e.target.value.toUpperCase())} />
          <Input label="Receive CCY" value={recv} onChange={(e) => setRecv(e.target.value.toUpperCase())} />
          <Input label="Pay amount (minor)" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="e.g. 100000" />
          <Button type="submit" loading={isLoading}>Quote</Button>
        </form>
      </Card>
      <Card padding="none">
        <Table
          columns={[
            { key: 'id', label: 'Quote', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
            { key: 'created_at', label: 'When', render: (r) => formatDate(r.created_at, 'PPpp') },
            { key: 'pay_currency', label: 'Pay' },
            { key: 'receive_currency', label: 'Receive' },
            { key: 'rate', label: 'Rate', align: 'right', render: (r) => r.rate ? Number(r.rate).toFixed(6) : '—' },
            { key: 'expires_at', label: 'Expires', render: (r) => r.expires_at ? formatDate(r.expires_at, 'pp') : '—' },
            { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> }
          ]}
          rows={quotes}
          rowKey="id"
          empty={<EmptyState title="No quotes" />}
        />
      </Card>
    </>
  );
};

const TravelRule = () => {
  const { data, isLoading } = useListTravelRuleQuery({});
  const rows = data?.items || data?.rows || [];
  return (
    <Card padding="none">
      <Table
        columns={[
          { key: 'id', label: 'Payload', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
          { key: 'created_at', label: 'When', render: (r) => formatDate(r.created_at, 'PPpp') },
          { key: 'foreign_rail_code', label: 'Rail' },
          { key: 'originator_name', label: 'Originator', render: (r) => r.originator_name || (r.originator && r.originator.name) || '—' },
          { key: 'beneficiary_name', label: 'Beneficiary', render: (r) => r.beneficiary_name || (r.beneficiary && r.beneficiary.name) || '—' },
          { key: 'sanctions_state', label: 'Sanctions', render: (r) => <StatusBadge status={r.sanctions_state || 'PASS'} size="sm" /> }
        ]}
        rows={rows}
        rowKey="id"
        loading={isLoading}
        empty={<EmptyState title="No travel-rule payloads" description="No FATF travel-rule payloads in this window." />}
      />
    </Card>
  );
};

export const Crossborder = () => {
  const [tab, setTab] = useState('txs');
  return (
    <>
      <PageHeader
        title="Cross-border"
        subtitle="Cross-border transactions, foreign rails, FX quotes, FATF travel rule."
        breadcrumbs={[{ label: 'Operator' }, { label: 'Cross-border' }]}
      />
      <Tabs
        className="mb-4"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'txs',         label: 'Transactions' },
          { key: 'rails',       label: 'Foreign rails' },
          { key: 'fx',          label: 'FX' },
          { key: 'travelrule',  label: 'Travel rule' }
        ]}
      />
      {tab === 'txs'        && <Txs />}
      {tab === 'rails'      && <Rails />}
      {tab === 'fx'         && <Fx />}
      {tab === 'travelrule' && <TravelRule />}
    </>
  );
};

export default Crossborder;
