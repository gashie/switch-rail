import { useMemo, useState } from 'react';
import { PageHeader, Card, Input, Button, EmptyState, formatDate } from '@sika/shared';
import { useGetGraphSliceQuery, useGetReputationQuery } from '@sika/shared/api/slices';
import { Network as NetworkIcon } from 'lucide-react';

// Simple deterministic radial layout. The real product would use
// react-force-graph-2d; for this scaffold the SVG layout is enough to read
// fan-out and shared-attribute clusters without pulling in d3-force.
const layoutNodes = (nodes) => {
  const center = { x: 320, y: 240 };
  const radius = 180;
  const n = nodes.length || 1;
  return nodes.map((node, i) => ({
    ...node,
    x: center.x + radius * Math.cos((i / n) * 2 * Math.PI),
    y: center.y + radius * Math.sin((i / n) * 2 * Math.PI)
  }));
};

const NODE_COLOR = {
  ACCOUNT: '#10b981',
  ALIAS: '#0ea5e9',
  DEVICE: '#f59e0b',
  IP: '#ef4444',
  PARTICIPANT: '#6366f1'
};

export const Network = () => {
  const [subject, setSubject] = useState('');
  const [submitted, setSubmitted] = useState(null);
  const { data: graph, isFetching } = useGetGraphSliceQuery(submitted ? { subject: submitted } : undefined, { skip: !submitted });
  const { data: rep } = useGetReputationQuery(submitted, { skip: !submitted });
  const nodes = useMemo(() => layoutNodes(graph?.nodes || []), [graph]);
  const nodeById = useMemo(() => {
    const m = new Map();
    for (const node of nodes) m.set(node.id, node);
    return m;
  }, [nodes]);
  const edges = graph?.edges || [];

  return (
    <>
      <PageHeader
        title="Network graph"
        subtitle="Accounts, aliases, devices, IPs and the edges between them. Used to spot mule clusters and shared-attribute fraud."
        breadcrumbs={[{ label: 'Operator' }, { label: 'Network graph' }]}
      />

      <Card className="mb-4">
        <form
          className="flex items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); setSubmitted(subject.trim()); }}
        >
          <div className="grow">
            <Input
              label="Subject key"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="account:9999100001  ·  alias:0244000001  ·  device:DEV-001"
              helper="Format: <type>:<value>. Pulls a 2-hop slice + reputation score."
            />
          </div>
          <Button type="submit" loading={isFetching}>Resolve</Button>
        </form>
      </Card>

      {!submitted ? (
        <EmptyState
          icon={<NetworkIcon className="w-8 h-8" />}
          title="Enter a subject"
          description="Type an account, alias, device, or IP to load its 2-hop neighbourhood."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Slice" className="lg:col-span-2">
            {nodes.length === 0 ? (
              <p className="text-sm text-graphite-500">No graph data for that subject.</p>
            ) : (
              <svg viewBox="0 0 640 480" className="w-full h-[420px] bg-graphite-50 rounded">
                {edges.map((e, i) => {
                  const src = nodeById.get(e.source);
                  const tgt = nodeById.get(e.target);
                  if (!src || !tgt) return null;
                  return (
                    <line
                      key={`e-${i}`}
                      x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                      stroke="#cbd5e1" strokeWidth="1"
                    />
                  );
                })}
                {nodes.map((n) => (
                  <g key={n.id}>
                    <circle
                      cx={n.x} cy={n.y} r={14}
                      fill={NODE_COLOR[n.type] || '#94a3b8'}
                      stroke={n.id === submitted ? '#0f766e' : 'white'}
                      strokeWidth={n.id === submitted ? 3 : 2}
                    >
                      <title>{`${n.type}:${n.label || n.id}`}</title>
                    </circle>
                    <text
                      x={n.x} y={n.y + 28}
                      textAnchor="middle"
                      fontSize="10" fill="#334155"
                    >
                      {n.label || n.id}
                    </text>
                  </g>
                ))}
              </svg>
            )}
          </Card>
          <Card title="Reputation">
            {rep ? (
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-graphite-500">Subject</dt>
                <dd className="text-right font-mono">{rep.subject_key || submitted}</dd>
                <dt className="text-graphite-500">Score</dt>
                <dd className="text-right tabular-nums">{rep.score ?? '—'}</dd>
                <dt className="text-graphite-500">Tier</dt>
                <dd className="text-right">{rep.tier || '—'}</dd>
                <dt className="text-graphite-500">Last updated</dt>
                <dd className="text-right">{rep.updated_at ? formatDate(rep.updated_at, 'PPpp') : '—'}</dd>
              </dl>
            ) : (
              <p className="text-sm text-graphite-500">No reputation record.</p>
            )}
          </Card>
        </div>
      )}
    </>
  );
};

export default Network;
