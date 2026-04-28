import clsx from 'clsx';
import { useEffect } from 'react';
import { X } from 'lucide-react';

export const Drawer = ({
  open,
  title,
  onClose,
  width = 480,
  children,
  className,
  'data-testid': testid
}) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid={testid}
      className="fixed inset-0 z-drawer"
    >
      <div
        className="absolute inset-0 bg-graphite-900/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={clsx(
          'absolute right-0 top-0 h-full bg-white border-l border-graphite-200 shadow-xl flex flex-col',
          className
        )}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
      >
        {(title || onClose) && (
          <header className="flex items-start justify-between gap-3 px-5 py-3 border-b border-graphite-200 shrink-0">
            {title && <h2 className="text-base font-semibold text-graphite-900">{title}</h2>}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="text-graphite-500 hover:text-graphite-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </header>
        )}
        <div className="px-5 py-4 overflow-auto grow">{children}</div>
      </aside>
    </div>
  );
};

export default Drawer;
