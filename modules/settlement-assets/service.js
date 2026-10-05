import { auditService } from '../audit/index.js';
import { uuidv7 } from '../../core/uuid.js';
import { requireAssetClient, listRegistered } from './asset-client.js';

export const createSettlementAssetsService = ({ db }) => {
  const settle = async (input) => {
    const client = requireAssetClient(input.assetType);
    const result = await client.settle(input);
    // Audit every settlement attempt — the regulator-grade audit trail is
    // non-negotiable for cross-border money movement.
    await db.withTransaction((c) =>
      auditService.record(c, {
        actorType: 'system',
        eventType: result.ok ? 'settlement_asset.settled' : 'settlement_asset.failed',
        resourceType: 'settlement_asset',
        resourceId: input.txId || uuidv7(),
        payload: {
          assetType: input.assetType,
          payAmountMinor: input.payAmountMinor,
          payCurrency: input.payCurrency,
          receiveAmountMinor: input.receiveAmountMinor,
          receiveCurrency: input.receiveCurrency,
          foreignRailCode: input.foreignRailCode,
          settlementRef: result.settlementRef || null,
          ok: result.ok,
          error: result.error || null
        }
      })
    );
    return result;
  };

  const adapters = () => listRegistered();

  return { settle, adapters };
};
