import { PageHeader, Card, StatCard, Table, StatusBadge, Money, formatDate, truncateHash } from '@sika/shared';
import { ArrowLeftRight, Coins, ShieldAlert, Gavel } from 'lucide-react';
import { useListTransactionsQuery } from '@sika/shared/api/slices';
import { useListFraudCasesQuery } from '@sika/shared/api/slices';
import { useListDisputesQuery } from '@sika/shared/api/slices';
import { Link } from 'react-router-dom';

export const Dashboard = () => {
  const { data: txData } = useListTransactionsQuery({ limit: 8 });
  const { data: fraudData } = useListFraudCasesQuery({ state: 'OPEN', limit: 1 });
  const { data: disputesData } = useListDisputesQuery({ state: 'OPEN', limit: 1 });
  const recentTx = txData?.rows || txData?.items || [];

  return (
    <>
      <PageHeader
        title="Operator dashboard"
        subtitle="Live rail health, throughput, and the queues that need eyes."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard
          label="Recent transactions"
          value={String(txData?.total ?? recentTx.length ?? '—')}
          icon={<ArrowLeftRight className="w-4 h-4" />}
        />
        <StatCard
          label="Fraud cases (open)"
          value={String(fraudData?.total ?? '—')}
          trend="flat"
          icon={<ShieldAlert className="w-4 h-4" />}
        />
        <StatCard
          label="Disputes (open)"
          value={String(disputesData?.total ?? '—')}
          trend="flat"
          icon={<Gavel className="w-4 h-4" />}
        />
        <StatCard
          label="Settlement (today)"
          value="—"
          icon={<Coins className="w-4 h-4" />}
        />
      </div>

      <Card title="Recent transactions" actions={<Link to="/transactions" className="text-sm text-emerald-700 hover:underline">View all →</Link>}>
        <Table
          columns={[
            { key: 'id', label: 'ID', render: (r) => <Link className="font-mono text-graphite-900 hover:text-emerald-700" to={`/transactions/${r.id}`}>{truncateHash(r.id)}</Link> },
            { key: 'created_at', label: 'Created', render: (r) => formatDate(r.created_at, 'pp') },
            { key: 'amount_value', label: 'Amount', align: 'right', render: (r) => <Money valueMinor={r.amount_value} currency={r.amount_currency} /> },
            { key: 'originator_participant', label: 'From' },
            { key: 'beneficiary_participant', label: 'To' },
            { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} size="sm" /> }
          ]}
          rows={recentTx}
          rowKey="id"
        />
      </Card>
    </>
  );
};

export default Dashboard;
