import { useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  PageHeader, Card, Table, StatusBadge, Money, Button, Input,
  EmptyState, formatDate, truncateHash, showToast
} from '@sika/shared';
import {
  useListCrossborderQuery, useQuoteFxMutation, useListForeignRailsQuery
} from '@sika/shared/api/slices';

export const Crossborder = () => {
  const dispatch = useDispatch();
  const [pay, setPay] = useState('GHS');
  const [recv, setRecv] = useState('USD');
  const [amt, setAmt] = useState('');
  const [quote, { isLoading: quoting }] = useQuoteFxMutation();
  const { data: txData, isLoading } = useListCrossborderQuery({ scope: 'self' });
  const { data: railData } = useListForeignRailsQuery();
  const rows = txData?.items || txData?.rows || [];
  const rails = railData?.items || railData?.rows || [];

  const onQuote = async (e) => {
    e.preventDefault();
    try {
      const res = await quote({ payCurrency: pay, receiveCurrency: recv, payAmountMinor: amt }).unwrap();
      dispatch(showToast({ kind: 'success', message: `Quote ${res?.quote?.id ? truncateHash(res.quote.id) : ''}` }));
      setAmt('');
    } catch (err) {
      dispatch(showToast({ kind: 'error', message: err?.data?.error?.message || 'Quote failed' }));
    }
  };

  return (
    <>
      <PageHeader title="Cross-border" subtitle="Send across foreign rails, with FX quotes locked at request time." />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card title="Request FX quote">
          <form className="grid grid-cols-3 gap-3 items-end" onSubmit={onQuote}>
            <Input label="Pay" value={pay} onChange={(e) => setPay(e.target.value.toUpperCase())} />
            <Input label="Receive" value={recv} onChange={(e) => setRecv(e.target.value.toUpperCase())} />
            <Input label="Pay (minor)" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="100000" />
            <div className="col-span-3 flex justify-end">
              <Button type="submit" loading={quoting}>Quote</Button>
            </div>
          </form>
        </Card>
        <Card title="Connected foreign rails">
          {rails.length === 0 ? <p className="text-sm text-graphite-500">No foreign rails configured.</p> : (
            <ul className="text-sm space-y-1">
              {rails.map((r) => (
                <li key={r.rail_code} className="flex items-center justify-between">
                  <span><span className="font-mono">{r.rail_code}</span> — {r.display_name}</span>
                  <StatusBadge status={r.state || 'ACTIVE'} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent cross-border" padding="none">
        <Table
          columns={[
            { key: 'id', label: 'ID', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
            { key: 'initiated_at', label: 'Initiated', render: (r) => formatDate(r.initiated_at, 'PPpp') },
            { key: 'foreign_rail_code', label: 'Rail' },
            { key: 'pay_amount_minor', label: 'Pay', align: 'right',
              render: (r) => <Money valueMinor={r.pay_amount_minor} currency={r.pay_currency} /> },
            { key: 'receive_amount_minor', label: 'Receive', align: 'right',
              render: (r) => <Money valueMinor={r.receive_amount_minor} currency={r.receive_currency} /> },
            { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> }
          ]}
          rows={rows}
          rowKey="id"
          loading={isLoading}
          empty={<EmptyState title="No cross-border txs yet" />}
        />
      </Card>
    </>
  );
};

export default Crossborder;
