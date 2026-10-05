import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Table } from '../Table.jsx';
import { StatCard } from '../StatCard.jsx';
import { Timeline } from '../Timeline.jsx';
import { Modal } from '../Modal.jsx';
import { Drawer } from '../Drawer.jsx';
import { EmptyState } from '../EmptyState.jsx';
import { PageHeader } from '../PageHeader.jsx';
import { FiltersBar } from '../FiltersBar.jsx';
import { Pagination } from '../Pagination.jsx';

const html = (el) => renderToStaticMarkup(el);

describe('Table', () => {
  const cols = [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' }
  ];
  it('renders rows', () => {
    const rows = [{ id: '1', name: 'Alpha' }, { id: '2', name: 'Beta' }];
    const out = html(<Table columns={cols} rows={rows} rowKey="id" />);
    expect(out).toContain('Alpha');
    expect(out).toContain('Beta');
  });
  it('renders skeleton rows when loading', () => {
    const out = html(<Table columns={cols} rows={[]} rowKey="id" loading />);
    expect(out).toContain('animate-pulse');
  });
  it('renders empty slot when no rows and not loading', () => {
    const out = html(<Table columns={cols} rows={[]} rowKey="id" />);
    expect(out).toContain('No results');
  });
});

describe('StatCard', () => {
  it('renders label and value', () => {
    const out = html(<StatCard label="TPS" value="124" />);
    expect(out).toContain('TPS');
    expect(out).toContain('124');
  });
  it('renders delta with up trend', () => {
    const out = html(<StatCard label="X" value="1" delta="+12%" trend="up" />);
    expect(out).toContain('+12%');
    expect(out).toContain('text-emerald-600');
  });
  it('renders skeleton when loading', () => {
    const out = html(<StatCard label="X" value="1" loading />);
    expect(out).toContain('animate-pulse');
  });
});

describe('Timeline', () => {
  it('renders entries', () => {
    const out = html(<Timeline entries={[
      { at: '2026-04-26T10:00:00Z', by: 'system', label: 'Created' },
      { at: '2026-04-26T10:01:00Z', by: 'op-1', label: 'Authorized' }
    ]} />);
    expect(out).toContain('Created');
    expect(out).toContain('Authorized');
  });
  it('renders empty state', () => {
    const out = html(<Timeline entries={[]} />);
    expect(out).toContain('No timeline entries');
  });
});

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const out = html(<Modal open={false} title="Hi"><p>x</p></Modal>);
    expect(out).toBe('');
  });
  it('renders title and children when open', () => {
    const out = html(<Modal open={true} title="Confirm"><p>Are you sure?</p></Modal>);
    expect(out).toContain('Confirm');
    expect(out).toContain('Are you sure?');
    expect(out).toContain('role="dialog"');
  });
});

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    const out = html(<Drawer open={false} title="x" />);
    expect(out).toBe('');
  });
  it('renders title and children when open', () => {
    const out = html(<Drawer open={true} title="Details"><p>Body</p></Drawer>);
    expect(out).toContain('Details');
    expect(out).toContain('Body');
  });
});

describe('EmptyState', () => {
  it('renders title and description', () => {
    const out = html(<EmptyState title="Nothing here" description="Try a different filter" />);
    expect(out).toContain('Nothing here');
    expect(out).toContain('Try a different filter');
  });
});

describe('PageHeader', () => {
  it('renders title and breadcrumbs', () => {
    const out = html(<PageHeader title="Transactions" breadcrumbs={[{ label: 'Operator' }, { label: 'Transactions' }]} />);
    expect(out).toContain('Transactions');
    expect(out).toContain('Operator');
  });
});

describe('FiltersBar', () => {
  it('renders text and select filters', () => {
    const out = html(
      <FiltersBar
        filters={[
          { type: 'text', key: 'q', label: 'Search' },
          { type: 'select', key: 'state', label: 'State', options: [{ value: '', label: 'All' }, { value: 'CONFIRMED', label: 'Confirmed' }] }
        ]}
        value={{}}
        onChange={() => {}}
        onApply={() => {}}
      />
    );
    expect(out).toContain('Search');
    expect(out).toContain('State');
    expect(out).toContain('Confirmed');
  });
});

describe('Pagination', () => {
  it('shows X-Y of Z', () => {
    const out = html(<Pagination total={250} page={2} pageSize={50} onPageChange={() => {}} />);
    expect(out).toContain('51');
    expect(out).toContain('100');
    expect(out).toContain('250');
  });
  it('disables prev on first page', () => {
    const out = html(<Pagination total={100} page={1} pageSize={50} onPageChange={() => {}} />);
    expect(out).toMatch(/Previous page[^>]*disabled/);
  });
  it('disables next on last page', () => {
    const out = html(<Pagination total={100} page={2} pageSize={50} onPageChange={() => {}} />);
    expect(out).toMatch(/Next page[^>]*disabled/);
  });
});
