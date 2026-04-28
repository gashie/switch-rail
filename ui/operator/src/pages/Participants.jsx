import { useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  PageHeader, Card, Table, FiltersBar, Pagination, StatusBadge,
  Button, Modal, EmptyState, formatDate, showToast
} from '@sika/shared';
import {
  useListParticipantsQuery,
  useSuspendParticipantMutation,
  useReinstateParticipantMutation
} from '@sika/shared/api/slices';
import { Users } from 'lucide-react';

const STATE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'KYB', label: 'KYB' },
  { value: 'CERTIFYING', label: 'Certifying' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' }
];

export const Participants = () => {
  const dispatch = useDispatch();
  const [filters, setFilters] = useState({ q: '', state: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [acting, setActing] = useState(null);
  const [reason, setReason] = useState('');
  const { data, isLoading } = useListParticipantsQuery({ ...filters, page, pageSize });
  const [suspend, { isLoading: suspending }] = useSuspendParticipantMutation();
  const [reinstate, { isLoading: reinstating }] = useReinstateParticipantMutation();
  const rows = data?.items || data?.rows || [];

  const onConfirm = async () => {
    if (!acting) return;
    try {
      const fn = acting.action === 'suspend' ? suspend : reinstate;
      await fn({ code: acting.row.code, reason: reason || acting.action.toUpperCase() }).unwrap();
      dispatch(showToast({ kind: 'success', message: `Participant ${acting.action}ed` }));
      setActing(null); setReason('');
    } catch (e) {
      dispatch(showToast({ kind: 'error', message: e?.data?.error?.message || 'Action failed' }));
    }
  };

  return (
    <>
      <PageHeader
        title="Participants"
        subtitle="Banks, wallets, fintechs, govt — onboarding, certification, suspend / reinstate."
        breadcrumbs={[{ label: 'Operator' }, { label: 'Participants' }]}
      />

      <FiltersBar
        className="mb-4"
        filters={[
          { type: 'text', key: 'q', label: 'Search', placeholder: 'code or legal name' },
          { type: 'select', key: 'state', label: 'State', options: STATE_OPTIONS }
        ]}
        value={filters}
        onChange={setFilters}
        onApply={(next) => { setFilters(next); setPage(1); }}
      />

      <Card padding="none">
        <Table
          columns={[
            { key: 'code', label: 'Code', render: (r) => <span className="font-mono">{r.code}</span> },
            { key: 'legal_name', label: 'Legal name' },
            { key: 'kind', label: 'Kind' },
            { key: 'state', label: 'State', render: (r) => <StatusBadge status={r.state} /> },
            { key: 'go_live_at', label: 'Live since', render: (r) => r.go_live_at ? formatDate(r.go_live_at, 'PP') : '—' },
            {
              key: 'actions', label: '',
              render: (r) =>
                r.state === 'SUSPENDED'
                  ? <Button size="sm" variant="secondary" onClick={() => setActing({ action: 'reinstate', row: r })}>Reinstate</Button>
                  : <Button size="sm" variant="danger" onClick={() => setActing({ action: 'suspend', row: r })}>Suspend</Button>
            }
          ]}
          rows={rows}
          rowKey="code"
          loading={isLoading}
          empty={<EmptyState icon={<Users className="w-8 h-8" />} title="No participants" description="No matching participants found." />}
        />
        <div className="px-3 border-t border-graphite-100">
          <Pagination
            total={data?.total || 0}
            page={page} pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          />
        </div>
      </Card>

      <Modal
        open={!!acting}
        title={acting?.action === 'suspend' ? 'Suspend participant' : 'Reinstate participant'}
        onClose={() => setActing(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setActing(null)}>Cancel</Button>
            <Button
              variant={acting?.action === 'suspend' ? 'danger' : 'primary'}
              loading={suspending || reinstating}
              onClick={onConfirm}
            >
              {acting?.action === 'suspend' ? 'Suspend' : 'Reinstate'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-graphite-700">
          {acting?.action === 'suspend'
            ? 'Suspends rail participation. New traffic blocked. Audit event written.'
            : 'Reinstates rail participation. Traffic resumes. Audit event written.'}
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

export default Participants;
