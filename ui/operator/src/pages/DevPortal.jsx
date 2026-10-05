import { useEffect, useMemo, useState } from 'react';
import { PageHeader, Card, Tabs, Input, Button, Table, EmptyState } from '@sika/shared';
import { Code2, KeyRound, BookOpen } from 'lucide-react';

const SANDBOX_KEYS = [
  { name: 'BANK-001 sandbox', key: 'sk_sandbox_BANK001_a1b2c3d4', scope: 'all' },
  { name: 'WALLET-002 sandbox', key: 'sk_sandbox_WALLET002_e5f6a7b8', scope: 'transactions, aliases' },
  { name: 'MERCHANT-DEMO sandbox', key: 'sk_sandbox_MERCHANT_DEMO_9c8d7e6f', scope: 'r2p, qr, refunds' }
];

const Endpoints = () => {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetch('/openapi.json')
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setDoc)
      .catch(setError);
  }, []);

  const rows = useMemo(() => {
    if (!doc) return [];
    const out = [];
    for (const [path, methods] of Object.entries(doc.paths || {})) {
      for (const [method, op] of Object.entries(methods)) {
        out.push({ id: `${method}-${path}`, method: method.toUpperCase(), path, tag: op.tags?.[0] || '' });
      }
    }
    return filter
      ? out.filter((r) => r.path.toLowerCase().includes(filter.toLowerCase()) || r.tag.toLowerCase().includes(filter.toLowerCase()))
      : out;
  }, [doc, filter]);

  if (error) {
    return <EmptyState title="Couldn't load openapi.json" description="Run pnpm openapi:generate then place docs/openapi.json next to the operator dist." />;
  }

  return (
    <>
      <Card className="mb-4">
        <Input
          label={`Search endpoints (${rows.length} of ${doc ? Object.values(doc.paths).reduce((n, m) => n + Object.keys(m).length, 0) : '…'})`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="e.g. /transactions, fraud, dispute"
        />
      </Card>
      <Card padding="none">
        <Table
          columns={[
            { key: 'method', label: 'Method',
              render: (r) => <span className={`font-mono text-xs px-2 py-0.5 rounded ${
                r.method === 'GET' ? 'bg-emerald-50 text-emerald-700' :
                r.method === 'POST' ? 'bg-blue-50 text-blue-700' :
                r.method === 'DELETE' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{r.method}</span> },
            { key: 'path', label: 'Path', render: (r) => <span className="font-mono text-sm">{r.path}</span> },
            { key: 'tag', label: 'Tag' }
          ]}
          rows={rows}
          rowKey="id"
          loading={!doc && !error}
          empty={<EmptyState title="No endpoints match" />}
        />
      </Card>
    </>
  );
};

const Keys = () => (
  <Card padding="none">
    <Table
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'key', label: 'Key',
          render: (r) => <code className="font-mono text-sm break-all">{r.key}</code> },
        { key: 'scope', label: 'Scope' },
        { key: 'actions', label: '',
          render: (r) => (
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(r.key)}>Copy</Button>
          ) }
      ]}
      rows={SANDBOX_KEYS}
      rowKey="key"
    />
  </Card>
);

const Quickstart = () => (
  <Card>
    <article className="prose prose-sm max-w-none">
      <h3 className="text-base font-semibold text-graphite-900">Quickstart</h3>
      <ol className="list-decimal pl-5 space-y-1 text-sm">
        <li>Pick a sandbox key from the <em>Keys</em> tab.</li>
        <li><code>curl -H 'Authorization: Bearer &lt;key&gt;' http://localhost:3000/health</code> — should return <code>{'{ ok: true, data: { status: "up" } }'}</code>.</li>
        <li>POST a domestic envelope to <code>/adapters-rest/payments</code>. The rail will route, authorize, post the credit leg, and confirm in under 100ms p95.</li>
        <li>Poll <code>/transactions/&lt;id&gt;</code> until <code>state = CONFIRMED</code>.</li>
        <li>Verify the receipt via <code>POST /public-status/verify-receipt</code> with the transaction id — this is what the citizen-facing receipt verifier uses.</li>
      </ol>
      <h4 className="mt-3 text-sm font-semibold text-graphite-900">Anti-drift</h4>
      <p className="text-sm">
        The OpenAPI document is regenerated from the canonical Joi schemas
        (<code>modules/*/schema.js</code>) by running
        <code className="mx-1">pnpm openapi:generate</code>. If a route's
        request shape changes, the doc shifts in the same commit.
      </p>
    </article>
  </Card>
);

export const DevPortal = () => {
  const [tab, setTab] = useState('quickstart');
  return (
    <>
      <PageHeader
        title="Developer portal"
        subtitle="Sandbox keys, OpenAPI index, quickstart."
        breadcrumbs={[{ label: 'Operator' }, { label: 'Developer portal' }]}
      />
      <Tabs
        className="mb-4"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'quickstart', label: 'Quickstart',  icon: <BookOpen className="w-4 h-4" /> },
          { key: 'endpoints',  label: 'Endpoints',   icon: <Code2 className="w-4 h-4" /> },
          { key: 'keys',       label: 'Sandbox keys', icon: <KeyRound className="w-4 h-4" /> }
        ]}
      />
      {tab === 'quickstart' && <Quickstart />}
      {tab === 'endpoints'  && <Endpoints />}
      {tab === 'keys'       && <Keys />}
    </>
  );
};

export default DevPortal;
