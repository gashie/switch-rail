import { useState } from 'react';
import {
  PageHeader, Card, Table, FiltersBar, Pagination, StatusBadge, Money,
  EmptyState, formatDate, truncateHash
} from '@sika/shared';
import { useListTransactionsQuery } from '@sika/shared/api/slices';

const PARTICIPANT_CODE = 'BANK-001';

const STATE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'AUTHORIZED', label: 'Authorized' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'REJECTED', label: 'Rejected' }
];

export const Transactions = () => {
  const [filters, setFilters] = useState({ q: '', state: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const { data, isLoading } = useListTransactionsQuery({ participantCode: PARTICIPANT_CODE, ...filters, limit: pageSize, offset: (page - 1) * pageSize });
  const rows = data?.rows || data?.items || [];

  return (
    <>
      <PageHeader title="Transactions" subtitle={`Inbound and outbound traffic for ${PARTICIPANT_CODE}.`} />
      <FiltersBar
        className="mb-4"
        filters={[
          { type: 'text', key: 'q', label: 'Search', placeholder: 'tx id, alias' },
          { type: 'select', key: 'state', label: 'State', options: STATE_OPTIONS }
        ]}
        value={filters}
        onChange={setFilters}
        onApply={(next) => { setFilters(next); setPage(1); }}
      />
      <Card padding="none">
        <Table
          columns={[
            { key: 'id', label: 'ID', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
            { key: 'created_at', label: 'Created', render: (r) => formatDate(r.created_at, 'PPpp') },
            { key: 'amount_value', label: 'Amount', align: 'right',
              render: (r) => <Money valueMinor={r.amount_value} currency={r.amount_currency} /> },
            {
              key: 'direction', label: 'Direction',
              render: (r) => r.originator_participant === PARTICIPANT_CODE
                ? <span className="text-red-700">Out</span>
                : <span className="text-emerald-700">In</span>
            },
            { key: 'counterparty', label: 'Counterparty',
              render: (r) => r.originator_participant === PARTICIPANT_CODE ? r.beneficiary_participant : r.originator_participant },
            { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> }
          ]}
          rows={rows}
          rowKey="id"
          loading={isLoading}
          empty={<EmptyState title="No transactions" />}
        />
        <div className="px-3 border-t border-graphite-100">
          <Pagination total={data?.total || 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
        </div>
      </Card>
    </>
  );
};

export default Transactions;
