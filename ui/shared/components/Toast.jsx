import clsx from 'clsx';
import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { toastSlice } from '../api/toast-slice.js';

const KIND_STYLES = {
  success: { bg: 'bg-emerald-50', border: 'border-emerald-200', fg: 'text-emerald-800', Icon: CheckCircle2 },
  error:   { bg: 'bg-red-50',     border: 'border-red-200',     fg: 'text-red-800',     Icon: AlertTriangle },
  info:    { bg: 'bg-blue-50',    border: 'border-blue-200',    fg: 'text-blue-800',    Icon: Info },
  warning: { bg: 'bg-amber-50',   border: 'border-amber-200',   fg: 'text-amber-800',   Icon: AlertTriangle }
};

const ToastItem = ({ toast }) => {
  const dispatch = useDispatch();
  const styles = KIND_STYLES[toast.kind] || KIND_STYLES.info;
  const { Icon } = styles;
  useEffect(() => {
    const ttl = toast.ttl ?? 4000;
    const t = setTimeout(() => dispatch(toastSlice.actions.dismissToast(toast.id)), ttl);
    return () => clearTimeout(t);
  }, [dispatch, toast.id, toast.ttl]);
  return (
    <div
      role="status"
      className={clsx(
        'flex items-start gap-2 min-w-[280px] max-w-md px-3 py-2 border rounded-md shadow-md',
        styles.bg, styles.border, styles.fg
      )}
    >
      <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <p className="text-sm grow">{toast.message}</p>
      <button
        type="button"
        onClick={() => dispatch(toastSlice.actions.dismissToast(toast.id))}
        aria-label="Dismiss"
        className="text-graphite-600 hover:text-graphite-900 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export const ToastHost = ({ className, 'data-testid': testid }) => {
  const toasts = useSelector((s) => s.toasts?.items || []);
  if (!toasts.length) return null;
  return (
    <div
      data-testid={testid}
      className={clsx('fixed top-4 right-4 z-toast flex flex-col gap-2', className)}
    >
      {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  );
};

export default ToastHost;
