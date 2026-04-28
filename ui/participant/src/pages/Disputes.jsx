import { useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  PageHeader, Card, Table, StatusBadge, Money, Button, Modal,
  Select, Input, Textarea, EmptyState, formatDate, truncateHash, showToast
} from '@sika/shared';
import {
  useListDisputesQuery, useFileDisputeMutation
} from '@sika/shared/api/slices';

export const Disputes = () => {
  const dispatch = useDispatch();
  const [filing, setFiling] = useState(false);
  const [form, setForm] = useState({ transactionId: '', reason: 'FRAUD', notes: '' });
  const { data, isLoading } = useListDisputesQuery({ scope: 'self' });
  const [file, { isLoading: filingNow }] = useFileDisputeMutation();
  const rows = data?.items || data?.rows || [];

  const onFile = async () => {
    try {
      await file({ transactionId: form.transactionId, reason: form.reason, notes: form.notes }).unwrap();
      dispatch(showToast({ kind: 'success', message: 'Dispute filed' }));
      setFiling(false);
      setForm({ transactionId: '', reason: 'FRAUD', notes: '' });
    } catch (e) {
      dispatch(showToast({ kind: 'error', message: e?.data?.error?.message || 'File failed' }));
    }
  };

  return (
    <>
      <PageHeader
        title="Disputes"
        subtitle="File and track disputes against your transactions."
        actions={<Button onClick={() => setFiling(true)}>File dispute</Button>}
      />
      <Card padding="none">
        <Table
          columns={[
            { key: 'id', label: 'Case', render: (r) => <span className="font-mono">{truncateHash(r.id)}</span> },
            { key: 'filed_at', label: 'Filed', render: (r) => formatDate(r.filed_at || r.created_at, 'PPpp') },
            { key: 'reason', label: 'Reason' },
            { key: 'transaction_id', label: 'Tx', render: (r) => <span className="font-mono">{truncateHash(r.transaction_id)}</span> },
            { key: 'amount_value', label: 'Amount', align: 'right',
              render: (r) => r.amount_value ? <Money valueMinor={r.amount_value} currency={r.amount_currency} /> : '—' },
            { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> }
          ]}
          rows={rows}
          rowKey="id"
          loading={isLoading}
          empty={<EmptyState title="No disputes filed" description="You can file a dispute on any of your transactions." />}
        />
      </Card>

      <Modal
        open={filing}
        title="File dispute"
        onClose={() => setFiling(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setFiling(false)}>Cancel</Button>
            <Button loading={filingNow} onClick={onFile}>File</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Transaction id" value={form.transactionId} onChange={(e) => setForm({ ...form, transactionId: e.target.value })} placeholder="019d…" />
          <Select
            label="Reason"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            options={[
              { value: 'FRAUD', label: 'Fraud (80-day fast-track window)' },
              { value: 'UNAUTHORIZED', label: 'Unauthorized' },
              { value: 'DUPLICATE', label: 'Duplicate' },
              { value: 'GOODS_NOT_RECEIVED', label: 'Goods not received' }
            ]}
          />
          <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </Modal>
    </>
  );
};

export default Disputes;
