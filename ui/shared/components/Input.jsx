import clsx from 'clsx';
import { useId } from 'react';

export const Input = ({
  label,
  value,
  onChange,
  error,
  helper,
  type = 'text',
  placeholder,
  disabled,
  leftIcon,
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
      <div className="relative">
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-500" aria-hidden="true">
            {leftIcon}
          </span>
        )}
        <input
          id={id}
          type={type}
          value={value ?? ''}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error || helper ? `${id}-helper` : undefined}
          data-testid={testid}
          className={clsx(
            'w-full h-10 rounded-md border bg-white text-graphite-900 text-base',
            'transition-colors duration-fast ease-sika',
            'focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1',
            'disabled:bg-graphite-100 disabled:cursor-not-allowed',
            leftIcon ? 'pl-10 pr-3' : 'px-3',
            error ? 'border-red-600' : 'border-graphite-300 hover:border-graphite-400'
          )}
          {...rest}
        />
      </div>
      {(error || helper) && (
        <span id={`${id}-helper`} className={clsx('text-xs', error ? 'text-red-600' : 'text-graphite-600')}>
          {error || helper}
        </span>
      )}
    </div>
  );
};

export default Input;
