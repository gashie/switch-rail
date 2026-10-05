import clsx from 'clsx';

export const Tabs = ({
  tabs,
  active,
  onChange,
  className,
  'data-testid': testid
}) => (
  <div
    role="tablist"
    data-testid={testid}
    className={clsx(
      'inline-flex items-center gap-1 border-b border-graphite-200',
      className
    )}
  >
    {tabs.map((t) => {
      const selected = t.key === active;
      return (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={selected}
          tabIndex={selected ? 0 : -1}
          onClick={() => onChange?.(t.key)}
          className={clsx(
            'inline-flex items-center gap-2 h-10 px-3 text-sm font-medium',
            'transition-colors duration-fast ease-sika',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
            'border-b-2 -mb-px',
            selected
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-graphite-600 hover:text-graphite-900'
          )}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      );
    })}
  </div>
);

export default Tabs;
