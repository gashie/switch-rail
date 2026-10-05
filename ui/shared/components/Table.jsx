import clsx from 'clsx';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Skeleton } from './Skeleton.jsx';

export const Table = ({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading = false,
  empty,
  error,
  sort,
  onSortChange,
  className,
  'data-testid': testid
}) => {
  const showRows = !loading && !error && Array.isArray(rows) && rows.length > 0;
  const showEmpty = !loading && !error && Array.isArray(rows) && rows.length === 0;
  const handleSort = (col) => {
    if (!col.sortable || !onSortChange) return;
    const isCurrent = sort?.key === col.key;
    const nextDir = isCurrent && sort?.dir === 'asc' ? 'desc' : 'asc';
    onSortChange({ key: col.key, dir: nextDir });
  };
  return (
    <div
      data-testid={testid}
      className={clsx('overflow-auto bg-white rounded-md border border-graphite-200', className)}
    >
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-graphite-50 z-10">
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={c.width ? { width: c.width } : undefined}
                  className={clsx(
                    'h-10 px-3 font-medium text-graphite-700 border-b border-graphite-200',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    !c.align && 'text-left',
                    c.sortable && 'cursor-pointer select-none hover:text-graphite-900'
                  )}
                  onClick={c.sortable ? () => handleSort(c) : undefined}
                  aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {c.sortable && active && (sort?.dir === 'asc'
                      ? <ChevronUp className="w-3 h-3" />
                      : <ChevronDown className="w-3 h-3" />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && Array.from({ length: 6 }).map((_, i) => (
            <tr key={`sk-${i}`} className="border-b border-graphite-100">
              {columns.map((c) => (
                <td key={c.key} className="h-10 px-3"><Skeleton variant="text" /></td>
              ))}
            </tr>
          ))}
          {showRows && rows.map((row) => {
            const k = typeof rowKey === 'function' ? rowKey(row) : row[rowKey];
            return (
              <tr
                key={k}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={clsx(
                  'border-b border-graphite-100 transition-colors duration-fast',
                  onRowClick && 'cursor-pointer hover:bg-graphite-50'
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={clsx(
                      'h-12 px-3 text-graphite-900',
                      c.align === 'right' && 'text-right',
                      c.align === 'center' && 'text-center'
                    )}
                  >
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {showEmpty && (
        <div className="py-10">{empty || <p className="text-center text-sm text-graphite-500">No results</p>}</div>
      )}
      {error && (
        <div className="py-10">{error}</div>
      )}
    </div>
  );
};

export default Table;
