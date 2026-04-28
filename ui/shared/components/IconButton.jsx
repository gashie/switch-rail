import clsx from 'clsx';

const SIZES = {
  sm: 'w-8 h-8',
  base: 'w-10 h-10',
  lg: 'w-12 h-12'
};

export const IconButton = ({
  icon,
  label,
  variant = 'ghost',
  size = 'base',
  onClick,
  disabled,
  className,
  'data-testid': testid,
  ...rest
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
    data-testid={testid}
    className={clsx(
      'inline-flex items-center justify-center rounded-md text-graphite-700',
      'transition-colors duration-fast ease-sika',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
      'hover:bg-graphite-100 active:bg-graphite-200 disabled:opacity-50 disabled:cursor-not-allowed',
      variant === 'danger' && 'hover:bg-red-50 hover:text-red-600',
      SIZES[size],
      className
    )}
    {...rest}
  >
    {icon}
  </button>
);

export default IconButton;
