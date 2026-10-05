// Pluggable settlement-asset interface. Each adapter implements:
//   client.settle({ payAmountMinor, payCurrency, receiveAmountMinor,
//                   receiveCurrency, foreignRailCode, txId })
//     -> { ok, settlementRef, settledAt }
//
// Production wires the real CBDC and stablecoin clients at boot. Tests +
// the demo use the fake adapters in cbdc-fake.js and stablecoin-fake.js.

import { AppError } from '../../core/errors.js';

const _registry = new Map();

export const registerAssetClient = (assetType, client) => {
  _registry.set(assetType, client);
};

export const getAssetClient = (assetType) => _registry.get(assetType) || null;

export const requireAssetClient = (assetType) => {
  const c = _registry.get(assetType);
  if (!c) {
    throw new AppError(
      'NOT_FOUND',
      `no settlement-asset client registered for ${assetType}`,
      404
    );
  }
  return c;
};

export const listRegistered = () => Array.from(_registry.keys());

export const _resetRegistry = () => _registry.clear();
