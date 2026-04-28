import clsx from 'clsx';

const PADDING = {
  none: 'p-0',
  sm: 'p-3',
  base: 'p-4',
  lg: 'p-5'
};

export const Card = ({
  title,
  subtitle,
  actions,
  children,
  padding = 'lg',
  className,
  'data-testid': testid
}) => (
  <section
    data-testid={testid}
    className={clsx(
      'bg-white rounded-md border border-graphite-200 shadow-sm',
      className
    )}
  >
    {(title || subtitle || actions) && (
      <header
        className={clsx(
          'flex items-start justify-between gap-3 border-b border-graphite-200',
          padding === 'none' ? 'px-4 py-3' : PADDING[padding].replace('p-', 'px-') + ' py-3'
        )}
      >
        <div className="min-w-0">
          {title && <h3 className="text-base font-semibold text-graphite-900 truncate">{title}</h3>}
          {subtitle && <p className="text-sm text-graphite-600 mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </header>
    )}
    <div className={PADDING[padding]}>{children}</div>
  </section>
);

export default Card;
