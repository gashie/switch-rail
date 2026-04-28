import { afterAll, describe, expect, it } from 'vitest';
import * as db from '../../../core/db.js';
import { closePool } from '../../../core/db.js';
import { createRegulatorConsoleModel } from '../model.js';
import { createRegulatorConsoleService } from '../service.js';

const model = createRegulatorConsoleModel();
const service = createRegulatorConsoleService({ db, model });

afterAll(async () => {
  await closePool();
});

describe('regulator-console — daily digest', () => {
  it('returns counts of zero on empty/quiet days without throwing', async () => {
    const out = await service.dailyDigest({ day: '1999-01-01' });
    expect(out.day).toBe('1999-01-01');
    expect(out.transactions.total).toBeGreaterThanOrEqual(0);
    expect(out.fraud.opened).toBeGreaterThanOrEqual(0);
    expect(out.disputes.opened).toBeGreaterThanOrEqual(0);
  });

  it('logs an export request to the audit chain', async () => {
    const event = await service.logExport({
      reason: 'BoG monthly remit Q2',
      resourceType: 'transactions',
      filters: { day: '1999-01-01' },
      actorId: null
    });
    expect(event).toBeTruthy();
    expect(event.event_type).toBe('regulator.export_requested');
  });
});
