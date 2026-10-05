import { PageHeader, Card, StatCard, Money } from '@sika/shared';
import { ArrowLeftRight, Gavel, Coins } from 'lucide-react';
import { useGetLiquidityQuery } from '@sika/shared/api/slices';

const PARTICIPANT_CODE = 'BANK-001';

export const Overview = () => {
  const { data: liq } = useGetLiquidityQuery(PARTICIPANT_CODE);
  return (
    <>
      <PageHeader
        title={`Welcome, ${PARTICIPANT_CODE}`}
        subtitle="Today's traffic, dispute queue, and current liquidity."
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <StatCard label="Inbound today" value="—" icon={<ArrowLeftRight className="w-4 h-4" />} />
        <StatCard label="Outbound today" value="—" icon={<ArrowLeftRight className="w-4 h-4" />} />
        <StatCard label="Open disputes"  value="—" icon={<Gavel className="w-4 h-4" />} />
      </div>
      <Card title="Current liquidity" actions={<Coins className="w-4 h-4 text-graphite-400" />}>
        {!liq ? <p className="text-sm text-graphite-500">No liquidity record.</p> : (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-graphite-500">Available</dt>
            <dd className="text-right"><Money valueMinor={liq.available_minor || 0} currency={liq.currency} /></dd>
            <dt className="text-graphite-500">Hold</dt>
            <dd className="text-right"><Money valueMinor={liq.hold_minor || 0} currency={liq.currency} /></dd>
            <dt className="text-graphite-500">Cap</dt>
            <dd className="text-right"><Money valueMinor={liq.cap_minor || 0} currency={liq.currency} /></dd>
          </dl>
        )}
      </Card>
    </>
  );
};

export default Overview;
