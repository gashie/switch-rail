import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';

export const PageHeader = ({
  title,
  subtitle,
  breadcrumbs,
  actions,
  className,
  'data-testid': testid
}) => (
  <header
    data-testid={testid}
    className={clsx('flex items-start justify-between gap-4 mb-4', className)}
  >
    <div className="min-w-0">
      {Array.isArray(breadcrumbs) && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-graphite-500 mb-1">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {b.href ? (
                <a href={b.href} className="hover:text-graphite-900">{b.label}</a>
              ) : (
                <span>{b.label}</span>
              )}
              {i < breadcrumbs.length - 1 && <ChevronRight className="w-3 h-3" aria-hidden="true" />}
            </span>
          ))}
        </nav>
      )}
      <h1 className="text-2xl font-semibold text-graphite-900 truncate">{title}</h1>
      {subtitle && <p className="text-sm text-graphite-600 mt-0.5">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </header>
);

export default PageHeader;
