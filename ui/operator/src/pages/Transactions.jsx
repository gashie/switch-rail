import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader, Card, Table, FiltersBar, Pagination,
  StatusBadge, Money, Button, EmptyState
} from '@sika/shared';
import { useListTransactionsQuery } from '@sika/shared/api/slices';
import { formatDate, truncateHash } from '@sika/shared';
import { Inbox } from 'lucide-react';

const STATE_OPTIONS = [
  { value: '',  label: 'All states' },
  { value: 'AUTHORIZED', label: 'Authorized' },
  { value: 'CONFIRMED',  label: 'Confirmed' },
  { value: 'REJECTED',   label: 'Rejected' },
  { value: 'PENDING_RECONCILIATION', label: 'Pending reconciliation' }
];

export const Transactions = () => {
  const [filters, setFilters] = useState({ q: '', state: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });

  const queryParams = useMemo(() => ({
    page,
    pageSize,
    state: filters.state,
    q: filters.q,
    from: filters.from,
    to: filters.to,
    sortKey: sort.key,
    sortDir: sort.dir
  }), [filters, page, pageSize, sort]);

  const { data, isLoading, isError, refetch } = useListTransactionsQuery(queryParams);
  const rows = data?.rows || data?.items || [];
  const total = data?.total || 0;

  const columns = [
    {
      key: 'id', label: 'Transaction', sortable: true,
      render: (r) => (
        <Link to={`/transactions/${r.id}`} className="font-mono text-graphite-900 hover:text-emerald-700">
          {truncateHash(r.id)}
        </Link>
      )
    },
    { key: 'created_at', label: 'Created', sortable: true, render: (r) => formatDate(r.created_at, 'PPpp') },
    {
      key: 'amount_value', label: 'Amount', align: 'right',
      render: (r) => <Money valueMinor={r.amount_value} currency={r.amount_currency} />
    },
    { key: 'originator_participant', label: 'Originator',  render: (r) => r.originator_participant },
    { key: 'beneficiary_participant', label: 'Beneficiary', render: (r) => r.beneficiary_participant },
    { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> }
  ];

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="All payment-rail traffic. Filter, drill in, force-reject when authorised."
        breadcrumbs={[{ label: 'Operator' }, { label: 'Transactions' }]}
        actions={<Button variant="secondary" onClick={refetch}>Refresh</Button>}
      />

      <FiltersBar
        className="mb-4"
        filters={[
          { type: 'text',   key: 'q',     label: 'Search', placeholder: 'tx id, alias, participant' },
          { type: 'select', key: 'state', label: 'State',  options: STATE_OPTIONS },
          { type: 'date',   key: 'from',  label: 'From' },
          { type: 'date',   key: 'to',    label: 'To' }
        ]}
        value={filters}
        onChange={setFilters}
        onApply={(next) => { setFilters(next); setPage(1); }}
      />

      <Card padding="none">
        <Table
          columns={columns}
          rows={rows}
          rowKey="id"
          loading={isLoading}
          sort={sort}
          onSortChange={setSort}
          empty={
            <EmptyState
              icon={<Inbox className="w-8 h-8" />}
              title="No transactions match"
              description="Try clearing filters or expanding the date range."
            />
          }
          error={isError && (
            <EmptyState
              title="Couldn't load transactions"
              description="The rail is unreachable or returned an error."
              action={<Button onClick={refetch}>Retry</Button>}
            />
          )}
        />
        <div className="px-3 border-t border-graphite-100">
          <Pagination
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          />
        </div>
      </Card>
    </>
  );
};

export default Transactions;
