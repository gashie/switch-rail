import clsx from 'clsx';
import { useId } from 'react';

export const Switch = ({
  label,
  checked,
  onChange,
  disabled,
  className,
  'data-testid': testid
}) => {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={clsx(
        'inline-flex items-center gap-3 cursor-pointer select-none',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <span className="relative inline-flex items-center w-10 h-6">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={!!checked}
          onChange={onChange}
          disabled={disabled}
          aria-checked={!!checked}
          data-testid={testid}
          className="peer sr-only"
        />
        <span
          className={clsx(
            'absolute inset-0 rounded-full transition-colors duration-fast ease-sika',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-focus-visible:ring-offset-2',
            checked ? 'bg-emerald-600' : 'bg-graphite-300'
          )}
        />
        <span
          className={clsx(
            'absolute top-1 left-1 inline-block w-4 h-4 bg-white rounded-full shadow-sm',
            'transition-transform duration-fast ease-sika',
            checked && 'translate-x-4'
          )}
        />
      </span>
      {label && <span className="text-base text-graphite-800">{label}</span>}
    </label>
  );
};

export default Switch;
