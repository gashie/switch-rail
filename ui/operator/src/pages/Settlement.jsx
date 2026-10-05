import { useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  PageHeader, Tabs, Card, Table, Button, Money, StatusBadge,
  Modal, EmptyState, formatDate, truncateHash, showToast, Pagination, Input
} from '@sika/shared';
import {
  useListPositionsQuery,
  useListCyclesQuery,
  useCloseCycleMutation,
  useListLedgerJournalsQuery,
  useGetLiquidityQuery
} from '@sika/shared/api/slices';
import { Coins } from 'lucide-react';

const Positions = () => {
  const { data, isLoading } = useListPositionsQuery({});
  const rows = data?.items || data?.rows || [];
  return (
    <Card padding="none">
      <Table
        columns={[
          { key: 'participant_code', label: 'Participant' },
          { key: 'currency', label: 'CCY' },
          { key: 'net_position_minor', label: 'Net position', align: 'right',
            render: (r) => <Money valueMinor={r.net_position_minor || r.net_minor || 0} currency={r.currency} /> },
          { key: 'as_of', label: 'As of', render: (r) => r.as_of ? formatDate(r.as_of, 'PPpp') : '—' }
        ]}
        rows={rows}
        rowKey={(r) => `${r.participant_code}-${r.currency}`}
        loading={isLoading}
        empty={<EmptyState icon={<Coins className="w-8 h-8" />} title="No positions" />}
      />
    </Card>
  );
};

const Cycles = () => {
  const dispatch = useDispatch();
  const { data, isLoading } = useListCyclesQuery({});
  const [closing, setClosing] = useState(null);
  const [reason, setReason] = useState('');
  const [closeCycle, { isLoading: loading }] = useCloseCycleMutation();
  const rows = data?.items || data?.rows || [];

  const onClose = async () => {
    try {
      await closeCycle({ cycleId: closing.id, reason: reason || 'OPERATOR_CLOSE' }).unwrap();
      dispatch(showToast({ kind: 'success', message: 'Cycle closed' }));
      setClosing(null); setReason('');
    } catch (e) {
      dispatch(showToast({ kind: 'error', message: e?.data?.error?.message || 'Close failed' }));
    }
  };

  return (
    <>
      <Card padding="none">
        <Table
          columns={[
            { key: 'id', label: 'Cycle', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
            { key: 'opened_at', label: 'Opened', render: (r) => formatDate(r.opened_at, 'PPpp') },
            { key: 'closed_at', label: 'Closed', render: (r) => r.closed_at ? formatDate(r.closed_at, 'PPpp') : '—' },
            { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> },
            { key: 'gross_credits_minor', label: 'Gross credits', align: 'right',
              render: (r) => r.gross_credits_minor ? <Money valueMinor={r.gross_credits_minor} currency={r.currency} /> : '—' },
            { key: 'gross_debits_minor', label: 'Gross debits', align: 'right',
              render: (r) => r.gross_debits_minor ? <Money valueMinor={r.gross_debits_minor} currency={r.currency} /> : '—' },
            {
              key: 'actions', label: '',
              render: (r) => r.state === 'OPEN' ? <Button size="sm" variant="secondary" onClick={() => setClosing(r)}>Close</Button> : null
            }
          ]}
          rows={rows}
          rowKey="id"
          loading={isLoading}
          empty={<EmptyState title="No cycles" />}
        />
      </Card>
      <Modal
        open={!!closing}
        title="Close settlement cycle"
        onClose={() => setClosing(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setClosing(null)}>Cancel</Button>
            <Button loading={loading} onClick={onClose}>Close cycle</Button>
          </>
        }
      >
        <p className="text-sm text-graphite-700">
          Closes the cycle, freezes net positions, and produces RTGS movement
          files. This cannot be reversed.
        </p>
        <textarea
          className="mt-3 w-full h-24 p-2 border border-graphite-300 rounded text-sm"
          placeholder="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
    </>
  );
};

const Ledger = () => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const { data, isLoading } = useListLedgerJournalsQuery({ page, pageSize });
  const rows = data?.items || data?.rows || [];
  return (
    <>
      <Card padding="none">
        <Table
          columns={[
            { key: 'id', label: 'Journal', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
            { key: 'created_at', label: 'When', render: (r) => formatDate(r.created_at, 'PPpp') },
            { key: 'kind', label: 'Kind' },
            { key: 'reason_code', label: 'Reason' },
            { key: 'amount_minor', label: 'Amount', align: 'right',
              render: (r) => r.amount_minor ? <Money valueMinor={r.amount_minor} currency={r.currency} /> : '—' }
          ]}
          rows={rows}
          rowKey="id"
          loading={isLoading}
          empty={<EmptyState title="No journals" />}
        />
        <div className="px-3 border-t border-graphite-100">
          <Pagination total={data?.total || 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
        </div>
      </Card>
    </>
  );
};

const Liquidity = () => {
  const [code, setCode] = useState('');
  const [submitted, setSubmitted] = useState(null);
  const { data, isFetching } = useGetLiquidityQuery(submitted, { skip: !submitted });
  return (
    <>
      <Card className="mb-4">
        <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); setSubmitted(code.trim()); }}>
          <div className="grow">
            <Input label="Participant code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="BANK-001" />
          </div>
          <Button type="submit" loading={isFetching}>Lookup</Button>
        </form>
      </Card>
      {submitted && (
        <Card title={`Liquidity — ${submitted}`}>
          {!data ? <p className="text-sm text-graphite-500">No liquidity record.</p> : (
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-graphite-500">Available</dt>
              <dd className="text-right"><Money valueMinor={data.available_minor || 0} currency={data.currency} /></dd>
              <dt className="text-graphite-500">Hold</dt>
              <dd className="text-right"><Money valueMinor={data.hold_minor || 0} currency={data.currency} /></dd>
              <dt className="text-graphite-500">Cap</dt>
              <dd className="text-right"><Money valueMinor={data.cap_minor || 0} currency={data.currency} /></dd>
              <dt className="text-graphite-500">As of</dt>
              <dd className="text-right">{data.as_of ? formatDate(data.as_of, 'PPpp') : '—'}</dd>
            </dl>
          )}
        </Card>
      )}
    </>
  );
};

export const Settlement = () => {
  const [tab, setTab] = useState('positions');
  return (
    <>
      <PageHeader
        title="Settlement"
        subtitle="Net positions, cycles, ledger journals, liquidity."
        breadcrumbs={[{ label: 'Operator' }, { label: 'Settlement' }]}
      />
      <Tabs
        className="mb-4"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'positions', label: 'Positions' },
          { key: 'cycles',    label: 'Cycles' },
          { key: 'ledger',    label: 'Ledger' },
          { key: 'liquidity', label: 'Liquidity' }
        ]}
      />
      {tab === 'positions' && <Positions />}
      {tab === 'cycles'    && <Cycles />}
      {tab === 'ledger'    && <Ledger />}
      {tab === 'liquidity' && <Liquidity />}
    </>
  );
};

export default Settlement;
