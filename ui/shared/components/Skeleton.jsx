import clsx from 'clsx';

const VARIANTS = {
  text: 'h-4 rounded',
  card: 'h-24 rounded-md',
  'table-row': 'h-10 rounded'
};

export const Skeleton = ({
  variant = 'text',
  width,
  height,
  className,
  'data-testid': testid
}) => {
  const style = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;
  return (
    <div
      role="status"
      aria-label="Loading"
      data-testid={testid}
      style={style}
      className={clsx(
        'block bg-graphite-100 animate-pulse',
        VARIANTS[variant] || VARIANTS.text,
        className
      )}
    />
  );
};

export default Skeleton;
