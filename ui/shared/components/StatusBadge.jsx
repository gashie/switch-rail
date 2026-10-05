import clsx from 'clsx';
import { toneFor, labelFor } from '../status-map.js';

const SIZES = {
  sm: 'h-5 px-2 text-xs',
  base: 'h-6 px-2.5 text-sm'
};

export const StatusBadge = ({
  status,
  size = 'base',
  className,
  'data-testid': testid
}) => {
  const tone = toneFor(status);
  const text = labelFor(status);
  return (
    <span
      data-testid={testid}
      data-status={status || 'unknown'}
      className={clsx(
        'inline-flex items-center font-medium rounded-full border',
        tone.bg,
        tone.fg,
        tone.border,
        SIZES[size] || SIZES.base,
        className
      )}
    >
      {text}
    </span>
  );
};

export default StatusBadge;
