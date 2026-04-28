import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as db from '../../../core/db.js';
import { closePool, query } from '../../../core/db.js';
import { createOpsDashboardModel } from '../model.js';
import { createOpsDashboardService } from '../service.js';

const model = createOpsDashboardModel();
const service = createOpsDashboardService({ db, model });

beforeAll(async () => {
  await query(`DELETE FROM ops_metric_snapshots`);
  await query(`DELETE FROM status_incident_updates`);
  await query(`DELETE FROM status_incidents`);
});

afterAll(async () => {
  await query(`DELETE FROM ops_metric_snapshots`);
  await query(`DELETE FROM status_incident_updates`);
  await query(`DELETE FROM status_incidents`);
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM ops_metric_snapshots`);
});

describe('ops-dashboard — snapshots', () => {
  it('records and lists a snapshot', async () => {
    const bucket = '2026-04-26T10:00:00.000Z';
    const row = await service.recordSnapshot({
      metricKind: 'tps',
      bucketMinute: bucket,
      railClass: 'DOMESTIC_INSTANT',
      valueNumeric: '124.5',
      valueCount: 124,
      payload: { source: 'roll-up' }
    });
    expect(row.metric_kind).toBe('tps');
    expect(row.rail_class).toBe('DOMESTIC_INSTANT');

    const rows = await service.listSnapshots({ metricKind: 'tps', limit: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(row.id);
  });

  it('listSnapshots filters by metricKind', async () => {
    await service.recordSnapshot({ metricKind: 'tps',  bucketMinute: '2026-04-26T10:00:00Z', valueNumeric: '50', valueCount: 50, payload: {} });
    await service.recordSnapshot({ metricKind: 'p95', bucketMinute: '2026-04-26T10:00:00Z', valueNumeric: '90', valueCount: null, payload: {} });
    const tpsRows = await service.listSnapshots({ metricKind: 'tps', limit: 100 });
    expect(tpsRows).toHaveLength(1);
    expect(tpsRows[0].metric_kind).toBe('tps');
  });
});

describe('ops-dashboard — summary', () => {
  it('returns a window summary that does not throw on empty tables', async () => {
    const out = await service.summary({ windowMinutes: 60 });
    expect(out.windowMinutes).toBe(60);
    expect(out.transactions).toBeDefined();
    expect(out.transactions.total).toBeGreaterThanOrEqual(0);
    expect(out.openIncidents).toBeGreaterThanOrEqual(0);
  });
});
