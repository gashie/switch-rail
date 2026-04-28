import clsx from 'clsx';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { Skeleton } from './Skeleton.jsx';

const TREND_COLORS = {
  up: 'text-emerald-600',
  down: 'text-red-600',
  flat: 'text-graphite-500'
};

const TREND_ICON = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus
};

export const StatCard = ({
  label,
  value,
  delta,
  trend = 'flat',
  icon,
  loading = false,
  className,
  'data-testid': testid
}) => {
  const TrendIcon = TREND_ICON[trend] || Minus;
  return (
    <div
      data-testid={testid}
      className={clsx(
        'bg-white rounded-md border border-graphite-200 shadow-sm p-4',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-graphite-600">{label}</p>
        {icon && <span className="text-graphite-400 shrink-0">{icon}</span>}
      </div>
      <div className="mt-2">
        {loading ? (
          <Skeleton variant="text" width={120} height={28} />
        ) : (
          <p className="text-2xl font-semibold text-graphite-900 tabular-nums">{value}</p>
        )}
      </div>
      {delta !== undefined && delta !== null && !loading && (
        <div className={clsx('mt-1 inline-flex items-center gap-1 text-sm', TREND_COLORS[trend])}>
          <TrendIcon className="w-3.5 h-3.5" />
          <span>{delta}</span>
        </div>
      )}
    </div>
  );
};

export default StatCard;
