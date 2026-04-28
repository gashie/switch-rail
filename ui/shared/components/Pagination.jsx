import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Select } from './Select.jsx';

const PAGE_SIZE_OPTIONS = [
  { value: '25',  label: '25 / page' },
  { value: '50',  label: '50 / page' },
  { value: '100', label: '100 / page' },
  { value: '250', label: '250 / page' }
];

export const Pagination = ({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  className,
  'data-testid': testid
}) => {
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total || 0);
  const canPrev = page > 1;
  const canNext = page < totalPages;
  return (
    <div
      data-testid={testid}
      className={clsx('flex items-center justify-between gap-3 py-2 text-sm text-graphite-700', className)}
    >
      <div>
        <span className="tabular-nums">{start.toLocaleString()}–{end.toLocaleString()}</span>
        <span className="text-graphite-500"> of </span>
        <span className="tabular-nums">{(total || 0).toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <Select
            value={String(pageSize)}
            options={PAGE_SIZE_OPTIONS}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          />
        )}
        <button
          type="button"
          aria-label="Previous page"
          disabled={!canPrev}
          onClick={() => canPrev && onPageChange(page - 1)}
          className="inline-flex items-center justify-center w-8 h-8 rounded border border-graphite-200 text-graphite-700 hover:bg-graphite-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="tabular-nums">{page}/{totalPages}</span>
        <button
          type="button"
          aria-label="Next page"
          disabled={!canNext}
          onClick={() => canNext && onPageChange(page + 1)}
          className="inline-flex items-center justify-center w-8 h-8 rounded border border-graphite-200 text-graphite-700 hover:bg-graphite-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default Pagination;
