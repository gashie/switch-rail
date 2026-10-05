import clsx from 'clsx';
import { useId } from 'react';

export const Select = ({
  label,
  value,
  onChange,
  options = [],
  error,
  helper,
  placeholder,
  disabled,
  className,
  'data-testid': testid,
  ...rest
}) => {
  const id = useId();
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-graphite-800">
          {label}
        </label>
      )}
      <select
        id={id}
        value={value ?? ''}
        onChange={onChange}
        disabled={disabled}
        aria-invalid={error ? 'true' : 'false'}
        data-testid={testid}
        className={clsx(
          'w-full h-10 rounded-md border bg-white text-graphite-900 text-base px-3',
          'transition-colors duration-fast ease-sika',
          'focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1',
          'disabled:bg-graphite-100 disabled:cursor-not-allowed',
          error ? 'border-red-600' : 'border-graphite-300 hover:border-graphite-400'
        )}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {(error || helper) && (
        <span className={clsx('text-xs', error ? 'text-red-600' : 'text-graphite-600')}>
          {error || helper}
        </span>
      )}
    </div>
  );
};

export default Select;
