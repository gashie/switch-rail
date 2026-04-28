// Page scaffolds for B10.5–B10.8. Each binds to its RTK Query slice in the
// follow-up block. Until then they render the canonical empty/coming-soon
// pattern so the routing tree, layout, and breadcrumbs are exercised
// end-to-end.
import { PageHeader, Card } from '@sika/shared';

const Stub = ({ title, breadcrumbs, body }) => (
  <>
    <PageHeader title={title} breadcrumbs={breadcrumbs} />
    <Card>{body}</Card>
  </>
);

export const Fraud = () => (
  <Stub
    title="Fraud cases"
    breadcrumbs={[{ label: 'Operator' }, { label: 'Fraud' }]}
    body={<p className="text-sm text-graphite-600">Fraud queue, rule pack, sanctions hits — wired in B10.5.</p>}
  />
);

export const Network = () => (
  <Stub
    title="Network graph"
    breadcrumbs={[{ label: 'Operator' }, { label: 'Network graph' }]}
    body={<p className="text-sm text-graphite-600">Force-directed graph of accounts, devices, IPs — wired in B10.5.</p>}
  />
);

export const Participants = () => (
  <Stub
    title="Participants"
    breadcrumbs={[{ label: 'Operator' }, { label: 'Participants' }]}
    body={<p className="text-sm text-graphite-600">Onboarding, certification, suspend / reinstate — wired in B10.5.</p>}
  />
);

export const Settlement = () => (
  <Stub
    title="Settlement"
    breadcrumbs={[{ label: 'Operator' }, { label: 'Settlement' }]}
    body={<p className="text-sm text-graphite-600">Net positions, cycles, ledger journals, liquidity — wired in B10.6.</p>}
  />
);

export const Eod = () => (
  <Stub
    title="End-of-day"
    breadcrumbs={[{ label: 'Operator' }, { label: 'EOD' }]}
    body={<p className="text-sm text-graphite-600">EOD runs, recon breaks, cutover — wired in B10.6.</p>}
  />
);

export const Disputes = () => (
  <Stub
    title="Disputes"
    breadcrumbs={[{ label: 'Operator' }, { label: 'Disputes' }]}
    body={<p className="text-sm text-graphite-600">Dispute queue, evidence, adjudication, fast-track — wired in B10.7.</p>}
  />
);

export const Crossborder = () => (
  <Stub
    title="Cross-border"
    breadcrumbs={[{ label: 'Operator' }, { label: 'Cross-border' }]}
    body={<p className="text-sm text-graphite-600">Cross-border txs, FX quotes, foreign rails, travel rule — wired in B10.8.</p>}
  />
);

export const Audit = () => (
  <Stub
    title="Audit"
    breadcrumbs={[{ label: 'Operator' }, { label: 'Audit' }]}
    body={<p className="text-sm text-graphite-600">Hash-chained audit log, daily roots — wired in B10.6.</p>}
  />
);

export const NotFound = () => (
  <Stub
    title="Not found"
    breadcrumbs={[{ label: 'Operator' }]}
    body={<p className="text-sm text-graphite-600">No page matches this URL.</p>}
  />
);
