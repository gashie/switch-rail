import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { Input } from './Input.jsx';
import { Select } from './Select.jsx';
import { Button } from './Button.jsx';

const Field = ({ filter, value, onLocalChange }) => {
  const v = value ?? '';
  if (filter.type === 'select') {
    return (
      <Select
        label={filter.label}
        value={v}
        options={filter.options}
        onChange={(e) => onLocalChange(filter.key, e.target.value)}
      />
    );
  }
  if (filter.type === 'date') {
    return (
      <Input
        type="date"
        label={filter.label}
        value={v}
        onChange={(e) => onLocalChange(filter.key, e.target.value)}
      />
    );
  }
  // 'text' / default
  return (
    <Input
      label={filter.label}
      value={v}
      placeholder={filter.placeholder}
      onChange={(e) => onLocalChange(filter.key, e.target.value)}
    />
  );
};

export const FiltersBar = ({
  filters,
  value,
  onChange,
  onApply,
  debounceMs = 300,
  className,
  'data-testid': testid
}) => {
  const [local, setLocal] = useState(value || {});
  const timer = useRef(null);
  useEffect(() => { setLocal(value || {}); }, [value]);
  const onLocalChange = (k, v) => {
    const next = { ...local, [k]: v };
    setLocal(next);
    if (onChange) onChange(next);
    if (onApply) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => onApply(next), debounceMs);
    }
  };
  const onClear = () => {
    const cleared = {};
    for (const f of filters) cleared[f.key] = '';
    setLocal(cleared);
    if (onChange) onChange(cleared);
    if (onApply) onApply(cleared);
  };
  return (
    <div
      data-testid={testid}
      className={clsx('flex flex-wrap items-end gap-3 p-3 bg-white rounded-md border border-graphite-200', className)}
    >
      {filters.map((f) => (
        <div key={f.key} className="min-w-[160px] grow">
          <Field filter={f} value={local[f.key]} onLocalChange={onLocalChange} />
        </div>
      ))}
      <Button variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  );
};

export default FiltersBar;
