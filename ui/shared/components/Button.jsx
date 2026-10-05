import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
  secondary: 'bg-graphite-100 text-graphite-900 hover:bg-graphite-200 active:bg-graphite-300',
  ghost: 'bg-transparent text-graphite-700 hover:bg-graphite-100 active:bg-graphite-200',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-700'
};

const SIZES = {
  sm: 'h-8 px-3 text-sm gap-1',
  base: 'h-10 px-4 text-base gap-2',
  lg: 'h-12 px-5 text-lg gap-2'
};

export const Button = ({
  variant = 'primary',
  size = 'base',
  loading = false,
  disabled = false,
  type = 'button',
  onClick,
  children,
  leftIcon,
  rightIcon,
  className,
  'data-testid': testid,
  ...rest
}) => (
  <button
    type={type}
    disabled={disabled || loading}
    onClick={onClick}
    data-testid={testid}
    className={clsx(
      'inline-flex items-center justify-center font-medium rounded-md select-none',
      'transition-colors duration-fast ease-sika',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      VARIANTS[variant],
      SIZES[size],
      className
    )}
    {...rest}
  >
    {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : leftIcon}
    <span>{children}</span>
    {!loading && rightIcon}
  </button>
);

export default Button;
