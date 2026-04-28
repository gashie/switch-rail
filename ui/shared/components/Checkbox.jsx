import clsx from 'clsx';
import { useId } from 'react';
import { Check } from 'lucide-react';

export const Checkbox = ({
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
        'inline-flex items-center gap-2 cursor-pointer select-none',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <span className="relative inline-flex items-center justify-center w-5 h-5">
        <input
          id={id}
          type="checkbox"
          checked={!!checked}
          onChange={onChange}
          disabled={disabled}
          data-testid={testid}
          className="peer sr-only"
        />
        <span
          className={clsx(
            'absolute inset-0 rounded-base border-2 transition-colors duration-fast ease-sika',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-focus-visible:ring-offset-2',
            checked ? 'bg-emerald-600 border-emerald-600' : 'bg-white border-graphite-400 hover:border-graphite-500'
          )}
        />
        {checked && <Check className="relative w-3.5 h-3.5 text-white" aria-hidden="true" />}
      </span>
      {label && <span className="text-base text-graphite-800">{label}</span>}
    </label>
  );
};

export default Checkbox;
