import { useState } from 'react';
import { Card, Money, StatusBadge, Button, Input, formatDate } from '@sika/shared';
import {
  useGetPublicStatusQuery,
  useVerifyReceiptMutation
} from '@sika/shared/api/slices';
import { CheckCircle2, AlertTriangle, Receipt } from 'lucide-react';

const SeverityBadge = ({ overall }) => {
  const tone = overall === 'OPERATIONAL' ? 'CONFIRMED'
            : overall === 'CRITICAL' ? 'REJECTED'
            : overall === 'MAJOR' ? 'PENDING_RECONCILIATION'
            : overall === 'MINOR' ? 'AUTHORIZED'
            : 'INITIATED';
  return <StatusBadge status={tone} size="base" />;
};

export const App = () => {
  const { data, isLoading } = useGetPublicStatusQuery();
  const [verify, { data: receipt, isLoading: verifying, error }] = useVerifyReceiptMutation();
  const [tx, setTx] = useState('');
  const open = data?.open || [];
  const overall = data?.overall || (isLoading ? '…' : 'OPERATIONAL');

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-graphite-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-emerald-500 grid place-items-center font-bold text-graphite-900">S</div>
          <div>
            <h1 className="text-lg font-semibold text-graphite-900 leading-tight">Sika Rail</h1>
            <p className="text-xs text-graphite-500 leading-tight">Public status</p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 space-y-4">
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {overall === 'OPERATIONAL'
                ? <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                : <AlertTriangle className="w-7 h-7 text-amber-600" />}
              <div>
                <h2 className="text-base font-semibold text-graphite-900">
                  {overall === 'OPERATIONAL' ? 'All systems operational' : `Service ${overall.toLowerCase()}`}
                </h2>
                <p className="text-xs text-graphite-500">Live as of {formatDate(new Date(), 'PPpp')}</p>
              </div>
            </div>
            <SeverityBadge overall={overall} />
          </div>
        </Card>

        {open.length > 0 && (
          <Card title="Open incidents">
            <ul className="divide-y divide-graphite-200">
              {open.map((i) => (
                <li key={i.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{i.title}</span>
                    <StatusBadge status={i.severity === 'CRITICAL' ? 'REJECTED' : 'AUTHORIZED'} size="sm" />
                  </div>
                  <p className="text-xs text-graphite-500">Declared {formatDate(i.declared_at, 'PPpp')}</p>
                  {i.description && <p className="text-sm text-graphite-700 mt-1">{i.description}</p>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Verify a receipt">
          <p className="text-sm text-graphite-600 mb-3">
            Paste a transaction id (the long code on your receipt) to confirm
            it was processed by the rail. No personal information is shown.
          </p>
          <form
            className="flex items-end gap-3"
            onSubmit={(e) => { e.preventDefault(); verify({ transactionId: tx.trim() }); }}
          >
            <div className="grow">
              <Input
                label="Transaction id"
                value={tx}
                onChange={(e) => setTx(e.target.value)}
                placeholder="019dcf96-9f7f-7f3c-a6f5-b0b412476f56"
                leftIcon={<Receipt className="w-4 h-4" />}
              />
            </div>
            <Button type="submit" loading={verifying}>Verify</Button>
          </form>

          {error && <p className="mt-3 text-sm text-red-700">Couldn't reach the rail. Try again in a moment.</p>}

          {receipt && (
            <div className="mt-4 border border-graphite-200 rounded p-3 bg-graphite-50 text-sm">
              {!receipt.found ? (
                <p className="text-red-700">No transaction matches that id.</p>
              ) : (
                <dl className="grid grid-cols-2 gap-y-2">
                  <dt className="text-graphite-500">State</dt>
                  <dd className="text-right"><StatusBadge status={receipt.state} size="sm" /></dd>
                  <dt className="text-graphite-500">Amount</dt>
                  <dd className="text-right"><Money valueMinor={receipt.amountMinor} currency={receipt.currency} /></dd>
                  <dt className="text-graphite-500">From</dt>
                  <dd className="text-right">{receipt.originatorParticipant}</dd>
                  <dt className="text-graphite-500">To</dt>
                  <dd className="text-right">{receipt.beneficiaryParticipant}</dd>
                  <dt className="text-graphite-500">Confirmed</dt>
                  <dd className="text-right">{receipt.confirmedAt ? formatDate(receipt.confirmedAt, 'PPpp') : '—'}</dd>
                </dl>
              )}
            </div>
          )}
        </Card>
      </main>

      <footer className="border-t border-graphite-200 py-4 text-center text-xs text-graphite-500">
        Sika Rail · Operator: Sika · v0.10
      </footer>
    </div>
  );
};

export default App;
