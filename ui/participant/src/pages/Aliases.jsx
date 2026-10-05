import { useState } from 'react';
import {
  PageHeader, Card, Table, FiltersBar, Pagination, StatusBadge,
  EmptyState, formatDate
} from '@sika/shared';
import { useListAliasesQuery } from '@sika/shared/api/slices';

const TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'MSISDN', label: 'MSISDN' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'GHANACARD', label: 'Ghanacard NIA' },
  { value: 'TIN', label: 'TIN' }
];

export const Aliases = () => {
  const [filters, setFilters] = useState({ q: '', type: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const { data, isLoading } = useListAliasesQuery({ ...filters, page, pageSize });
  const rows = data?.items || data?.rows || [];
  return (
    <>
      <PageHeader title="Aliases" subtitle="MSISDN, email, Ghanacard, TIN aliases under your account base." />
      <FiltersBar
        className="mb-4"
        filters={[
          { type: 'text', key: 'q', label: 'Search', placeholder: 'alias value' },
          { type: 'select', key: 'type', label: 'Type', options: TYPE_OPTIONS }
        ]}
        value={filters}
        onChange={setFilters}
        onApply={(next) => { setFilters(next); setPage(1); }}
      />
      <Card padding="none">
        <Table
          columns={[
            { key: 'alias_value', label: 'Alias', render: (r) => <span className="font-mono">{r.alias_value}</span> },
            { key: 'alias_type', label: 'Type' },
            { key: 'account_id', label: 'Account', render: (r) => <span className="font-mono">{r.account_id}</span> },
            { key: 'verified_at', label: 'Verified', render: (r) => r.verified_at ? formatDate(r.verified_at, 'PP') : '—' },
            { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> }
          ]}
          rows={rows}
          rowKey="id"
          loading={isLoading}
          empty={<EmptyState title="No aliases" />}
        />
        <div className="px-3 border-t border-graphite-100">
          <Pagination total={data?.total || 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
        </div>
      </Card>
    </>
  );
};

export default Aliases;
