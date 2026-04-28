import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../Button.jsx';
import { IconButton } from '../IconButton.jsx';
import { Input } from '../Input.jsx';
import { Select } from '../Select.jsx';
import { Textarea } from '../Textarea.jsx';
import { Checkbox } from '../Checkbox.jsx';
import { Switch } from '../Switch.jsx';
import { Card } from '../Card.jsx';
import { Skeleton } from '../Skeleton.jsx';
import { StatusBadge } from '../StatusBadge.jsx';
import { Money } from '../Money.jsx';
import { Tabs } from '../Tabs.jsx';

const html = (el) => renderToStaticMarkup(el);

describe('Button', () => {
  it('renders children with primary variant by default', () => {
    const out = html(<Button>Pay</Button>);
    expect(out).toContain('Pay');
    expect(out).toContain('bg-emerald-600');
  });

  it('applies danger variant', () => {
    const out = html(<Button variant="danger">Reject</Button>);
    expect(out).toContain('bg-red-600');
  });

  it('disables when loading and shows a spinner', () => {
    const out = html(<Button loading>Saving</Button>);
    expect(out).toContain('disabled');
    expect(out).toContain('animate-spin');
  });
});

describe('IconButton', () => {
  it('sets aria-label from label prop', () => {
    const out = html(<IconButton icon={<span>x</span>} label="Close" />);
    expect(out).toContain('aria-label="Close"');
  });
});

describe('Input', () => {
  it('renders label and connects it via htmlFor / id', () => {
    const out = html(<Input label="Amount" value="" onChange={() => {}} />);
    expect(out).toContain('Amount');
    expect(out).toMatch(/for="[^"]+"/);
    expect(out).toMatch(/id="[^"]+"/);
  });

  it('shows error styling and aria-invalid', () => {
    const out = html(<Input label="X" error="bad" value="" onChange={() => {}} />);
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('bad');
  });
});

describe('Select', () => {
  it('renders all option labels', () => {
    const out = html(
      <Select
        label="Country"
        value="GH"
        onChange={() => {}}
        options={[
          { value: 'GH', label: 'Ghana' },
          { value: 'NG', label: 'Nigeria' }
        ]}
      />
    );
    expect(out).toContain('Ghana');
    expect(out).toContain('Nigeria');
  });
});

describe('Textarea', () => {
  it('renders a textarea element', () => {
    const out = html(<Textarea label="Note" value="" onChange={() => {}} />);
    expect(out).toContain('<textarea');
  });
});

describe('Checkbox', () => {
  it('renders an input of type checkbox with label', () => {
    const out = html(<Checkbox label="Agree" checked={false} onChange={() => {}} />);
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('Agree');
  });
});

describe('Switch', () => {
  it('renders role=switch and aria-checked reflects state', () => {
    const out = html(<Switch label="On" checked={true} onChange={() => {}} />);
    expect(out).toContain('role="switch"');
    expect(out).toContain('aria-checked="true"');
  });
});

describe('Card', () => {
  it('renders title, subtitle and children', () => {
    const out = html(
      <Card title="Heading" subtitle="Sub">
        <p>Body</p>
      </Card>
    );
    expect(out).toContain('Heading');
    expect(out).toContain('Sub');
    expect(out).toContain('Body');
  });
});

describe('Skeleton', () => {
  it('renders with role=status and animate-pulse', () => {
    const out = html(<Skeleton variant="text" width={100} />);
    expect(out).toContain('role="status"');
    expect(out).toContain('animate-pulse');
  });
});

describe('StatusBadge', () => {
  it('uses the success tone classes for CONFIRMED', () => {
    const out = html(<StatusBadge status="CONFIRMED" />);
    expect(out).toContain('Confirmed');
    expect(out).toContain('bg-emerald-50');
  });

  it('uses the fail tone classes for REJECTED', () => {
    const out = html(<StatusBadge status="REJECTED" />);
    expect(out).toContain('Rejected');
    expect(out).toContain('bg-red-50');
  });

  it('falls back gracefully on an unknown status', () => {
    const out = html(<StatusBadge status="WAT" />);
    expect(out).toContain('WAT');
  });
});

describe('Money', () => {
  it('formats GHS minor units', () => {
    const out = html(<Money valueMinor={15042n} currency="GHS" />);
    expect(out).toContain('GHS 150.42');
  });

  it('formats JPY (zero decimals)', () => {
    const out = html(<Money valueMinor={15000n} currency="JPY" />);
    expect(out).toContain('JPY 15,000');
  });

  it('omits the currency code when showCurrency=false', () => {
    const out = html(<Money valueMinor={15042n} currency="GHS" showCurrency={false} />);
    expect(out).not.toContain('GHS ');
    expect(out).toContain('150.42');
  });
});

describe('Tabs', () => {
  it('renders all tab labels and marks the active one', () => {
    const out = html(
      <Tabs
        tabs={[
          { key: 'a', label: 'Alpha' },
          { key: 'b', label: 'Beta' }
        ]}
        active="b"
        onChange={() => {}}
      />
    );
    expect(out).toContain('Alpha');
    expect(out).toContain('Beta');
    expect(out).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>[\s\S]*Beta/);
  });
});
