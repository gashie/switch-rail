import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as db from '../../../core/db.js';
import { closePool, query } from '../../../core/db.js';
import { createUssdGatewayModel } from '../model.js';
import { createUssdGatewayService } from '../service.js';

const model = createUssdGatewayModel();
const service = createUssdGatewayService({ db, model });

beforeAll(async () => {
  await query(`DELETE FROM ussd_sessions`);
});

afterAll(async () => {
  await query(`DELETE FROM ussd_sessions`);
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM ussd_sessions`);
});

describe('ussd-gateway — callback handling', () => {
  it('responds with the root menu for an empty text', async () => {
    const out = await service.handleCallback({
      sessionId: 'S1', msisdn: '+233244000001', serviceCode: '*711#', text: ''
    });
    expect(out).toContain('CON');
    expect(out).toContain('Send money');
    expect(out).toContain('Verify receipt');
  });

  it('routes selection 1 to send-money picker', async () => {
    const out = await service.handleCallback({
      sessionId: 'S2', msisdn: '+233244000001', serviceCode: '*711#', text: '1'
    });
    expect(out).toContain('beneficiary alias');
  });

  it('routes selection 2 to a terminal balance lookup', async () => {
    const out = await service.handleCallback({
      sessionId: 'S3', msisdn: '+233244000001', serviceCode: '*711#', text: '2'
    });
    expect(out.startsWith('END')).toBe(true);
  });

  it('logs a session per call', async () => {
    await service.handleCallback({ sessionId: 'A', msisdn: '+233244000001', serviceCode: '*711#', text: '' });
    await service.handleCallback({ sessionId: 'B', msisdn: '+233244000001', serviceCode: '*711#', text: '1' });
    const rows = await service.listSessions({ msisdn: '+233244000001', limit: 100 });
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to invalid for unknown selections', async () => {
    const out = await service.handleCallback({
      sessionId: 'S4', msisdn: '+233244000001', serviceCode: '*711#', text: '99'
    });
    expect(out).toContain('END');
  });
});
