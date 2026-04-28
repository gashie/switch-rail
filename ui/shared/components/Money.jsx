import clsx from 'clsx';
import { formatMinor } from '../format.js';

export const Money = ({
  valueMinor,
  currency,
  align = 'right',
  mono = true,
  showCurrency = true,
  className,
  'data-testid': testid
}) => {
  const formatted = formatMinor(valueMinor, currency, { symbol: showCurrency });
  return (
    <span
      data-testid={testid}
      data-value-minor={String(valueMinor ?? '')}
      data-currency={currency || ''}
      className={clsx(
        'tabular-nums',
        mono && 'font-mono',
        align === 'right' && 'text-right',
        align === 'left' && 'text-left',
        className
      )}
    >
      {formatted}
    </span>
  );
};

export default Money;
