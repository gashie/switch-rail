import clsx from 'clsx';
import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { formatDate } from '../format.js';

export const Timeline = ({
  entries,
  className,
  'data-testid': testid
}) => {
  const [openIdx, setOpenIdx] = useState(null);
  if (!entries || entries.length === 0) {
    return <p className="text-sm text-graphite-500">No timeline entries.</p>;
  }
  return (
    <ol
      data-testid={testid}
      className={clsx('relative border-l-2 border-graphite-200 pl-4', className)}
    >
      {entries.map((e, i) => {
        const open = openIdx === i;
        const expandable = !!e.payload;
        return (
          <li key={i} className="mb-4 last:mb-0">
            <span className="absolute left-[-7px] mt-1.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-graphite-900">{e.label}</p>
                <p className="text-xs text-graphite-500 mt-0.5">
                  {formatDate(e.at, 'PPp')}{e.by ? ` · ${e.by}` : ''}
                </p>
              </div>
              {expandable && (
                <button
                  type="button"
                  onClick={() => setOpenIdx(open ? null : i)}
                  className="text-graphite-500 hover:text-graphite-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
                  aria-label={open ? 'Collapse details' : 'Expand details'}
                >
                  {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              )}
            </div>
            {expandable && open && (
              <pre className="mt-2 p-2 bg-graphite-50 border border-graphite-200 rounded text-xs text-graphite-800 overflow-auto font-mono">
                {JSON.stringify(e.payload, null, 2)}
              </pre>
            )}
          </li>
        );
      })}
    </ol>
  );
};

export default Timeline;
