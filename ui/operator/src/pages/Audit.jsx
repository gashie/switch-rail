import { useState } from 'react';
import {
  PageHeader, Card, Table, FiltersBar, Pagination, EmptyState,
  formatDate, truncateHash
} from '@sika/shared';
import { useListAuditQuery, useGetDailyChainQuery } from '@sika/shared/api/slices';

const RESOURCE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'transactions', label: 'transactions' },
  { value: 'crossborder_tx', label: 'crossborder_tx' },
  { value: 'dispute_case', label: 'dispute_case' },
  { value: 'fraud_case', label: 'fraud_case' },
  { value: 'participant', label: 'participant' },
  { value: 'settlement_cycle', label: 'settlement_cycle' }
];

export const Audit = () => {
  const [filters, setFilters] = useState({ q: '', resource_type: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [chainDate, setChainDate] = useState(new Date().toISOString().slice(0, 10));
  const { data, isLoading } = useListAuditQuery({ ...filters, page, pageSize });
  const { data: chain } = useGetDailyChainQuery(chainDate);
  const rows = data?.items || data?.rows || [];

  return (
    <>
      <PageHeader
        title="Audit"
        subtitle="Hash-chained event log. Daily roots must match for the day to be considered tamper-proof."
        breadcrumbs={[{ label: 'Operator' }, { label: 'Audit' }]}
      />

      <Card title="Daily chain root" className="mb-4">
        <div className="flex items-end gap-3">
          <div>
            <label className="text-sm text-graphite-700">Date</label>
            <input
              type="date"
              value={chainDate}
              onChange={(e) => setChainDate(e.target.value)}
              className="block mt-1 h-10 px-2 border border-graphite-300 rounded-md text-sm"
            />
          </div>
          {chain && (
            <div className="text-sm">
              <p className="text-graphite-500">Root for {chainDate}</p>
              <p className="font-mono text-graphite-900 break-all">{chain.root || chain.daily_root || '—'}</p>
              <p className="text-graphite-500 mt-1">Events: {chain.event_count ?? '—'}</p>
            </div>
          )}
        </div>
      </Card>

      <FiltersBar
        className="mb-4"
        filters={[
          { type: 'text', key: 'q', label: 'Search', placeholder: 'event_type, resource_id' },
          { type: 'select', key: 'resource_type', label: 'Resource', options: RESOURCE_OPTIONS }
        ]}
        value={filters}
        onChange={setFilters}
        onApply={(next) => { setFilters(next); setPage(1); }}
      />

      <Card padding="none">
        <Table
          columns={[
            { key: 'id', label: 'Event', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
            { key: 'created_at', label: 'When', render: (r) => formatDate(r.created_at, 'PPpp') },
            { key: 'event_type', label: 'Type' },
            { key: 'resource_type', label: 'Resource' },
            { key: 'resource_id', label: 'Resource id', render: (r) => <span className="font-mono">{truncateHash(r.resource_id)}</span> },
            { key: 'actor_type', label: 'Actor' },
            { key: 'hash_prev', label: 'Prev hash', render: (r) => r.hash_prev ? <span className="font-mono text-xs">{truncateHash(r.hash_prev, 6, 4)}</span> : '—' }
          ]}
          rows={rows}
          rowKey="id"
          loading={isLoading}
          empty={<EmptyState title="No audit events match" />}
        />
        <div className="px-3 border-t border-graphite-100">
          <Pagination total={data?.total || 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
        </div>
      </Card>
    </>
  );
};

export default Audit;
