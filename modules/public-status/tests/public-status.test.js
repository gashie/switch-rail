import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as db from '../../../core/db.js';
import { closePool, query } from '../../../core/db.js';
import { createPublicStatusModel } from '../model.js';
import { createPublicStatusService } from '../service.js';

const model = createPublicStatusModel();
const service = createPublicStatusService({ db, model });

beforeAll(async () => {
  await query(`DELETE FROM status_incident_updates`);
  await query(`DELETE FROM status_incidents`);
});

afterAll(async () => {
  await query(`DELETE FROM status_incident_updates`);
  await query(`DELETE FROM status_incidents`);
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM status_incident_updates`);
  await query(`DELETE FROM status_incidents`);
});

describe('public-status — incidents', () => {
  it('declares, updates and resolves an incident', async () => {
    const inc = await service.declareIncident({
      scope: 'RAIL',
      severity: 'MAJOR',
      title: 'Credit-leg latency elevated',
      description: 'p95 30s vs 5s budget',
      metadata: { source: 'ops' },
      declaredBy: 'op-1'
    });
    expect(inc.state).toBe('OPEN');
    expect(inc.severity).toBe('MAJOR');

    await service.postUpdate({ incidentId: inc.id, body: 'Investigating', postedBy: 'op-1' });
    const updatesMid = await service.listUpdates({ incidentId: inc.id });
    expect(updatesMid).toHaveLength(1);

    const resolved = await service.resolveIncident({
      incidentId: inc.id,
      closingNote: 'Latency back to baseline',
      postedBy: 'op-1'
    });
    expect(resolved.state).toBe('RESOLVED');
    const updatesEnd = await service.listUpdates({ incidentId: inc.id });
    expect(updatesEnd).toHaveLength(2);
  });

  it('listOpen excludes resolved incidents', async () => {
    const inc = await service.declareIncident({
      scope: 'RAIL', severity: 'MINOR', title: 'Foo', description: '', metadata: {}, declaredBy: 'op'
    });
    let open = await service.listOpen();
    expect(open).toHaveLength(1);
    await service.resolveIncident({ incidentId: inc.id, closingNote: 'done', postedBy: 'op' });
    open = await service.listOpen();
    expect(open).toHaveLength(0);
  });

  it('verifyReceipt returns found:false for unknown ids', async () => {
    const out = await service.verifyReceipt({ transactionId: '00000000-0000-0000-0000-000000000000' });
    expect(out.found).toBe(false);
  });
});
