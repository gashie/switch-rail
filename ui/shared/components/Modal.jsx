import clsx from 'clsx';
import { useEffect } from 'react';
import { X } from 'lucide-react';

const SIZES = {
  sm: 'max-w-sm',
  base: 'max-w-md',
  lg: 'max-w-2xl'
};

export const Modal = ({
  open,
  title,
  onClose,
  actions,
  children,
  size = 'base',
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
      className="fixed inset-0 z-modal flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-graphite-900/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={clsx(
          'relative w-full mx-4 bg-white rounded-md shadow-lg border border-graphite-200',
          SIZES[size] || SIZES.base,
          className
        )}
      >
        {(title || onClose) && (
          <header className="flex items-start justify-between gap-3 px-5 py-3 border-b border-graphite-200">
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
        <div className="px-5 py-4">{children}</div>
        {actions && (
          <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-graphite-200 bg-graphite-50 rounded-b-md">
            {actions}
          </footer>
        )}
      </div>
    </div>
  );
};

export default Modal;
