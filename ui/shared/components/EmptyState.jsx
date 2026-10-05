import clsx from 'clsx';

export const EmptyState = ({
  icon,
  title,
  description,
  action,
  className,
  'data-testid': testid
}) => (
  <div
    data-testid={testid}
    className={clsx(
      'flex flex-col items-center justify-center text-center py-12 px-4',
      className
    )}
  >
    {icon && <div className="text-graphite-400 mb-3">{icon}</div>}
    {title && <h3 className="text-base font-semibold text-graphite-900">{title}</h3>}
    {description && <p className="mt-1 text-sm text-graphite-600 max-w-sm">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export default EmptyState;
