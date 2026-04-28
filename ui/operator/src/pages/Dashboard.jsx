import { PageHeader, Card, StatCard } from '@sika/shared';
import { ArrowLeftRight, Coins, ShieldAlert, Gavel } from 'lucide-react';

export const Dashboard = () => (
  <>
    <PageHeader
      title="Operator dashboard"
      subtitle="Live rail health, throughput, and the queues that need eyes."
    />
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
      <StatCard label="Throughput (today)"   value="124,308" delta="+8.2%" trend="up"   icon={<ArrowLeftRight className="w-4 h-4" />} />
      <StatCard label="Settlement (today)"   value="GHS 14.2M" delta="+1.4%" trend="up" icon={<Coins className="w-4 h-4" />} />
      <StatCard label="Fraud cases (open)"   value="6"      delta="-2"     trend="down" icon={<ShieldAlert className="w-4 h-4" />} />
      <StatCard label="Disputes (in SLA)"    value="12"     delta="0"      trend="flat" icon={<Gavel className="w-4 h-4" />} />
    </div>
    <Card title="Charts and feeds will land in B10.5">
      <p className="text-sm text-graphite-600">
        This dashboard is the landing surface for the operator console. B10.5
        wires real charts (TPS, settlement net, fraud-by-rule) and the live
        feed of recent state transitions.
      </p>
    </Card>
  </>
);

export default Dashboard;
