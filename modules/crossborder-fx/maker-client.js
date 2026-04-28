// Pluggable market-maker interface. Production wires real HTTP clients
// against AfreximBank, BoG reserve desk, or commercial FX desks. Tests +
// the demo use the fake adapter (maker-fake.js).
//
// Contract:
//   client.quote({ payCurrency, receiveCurrency, payAmount }) ->
//     Promise<{ rateDecimalStr, feePayMinor, feeReceiveMinor }>

import { AppError } from '../../core/errors.js';

let _factory = null;

export const registerMakerFactory = (factory) => {
  _factory = factory;
};

export const getMakerFactory = () => _factory;

export const requireMakerFactory = () => {
  if (!_factory) {
    throw new AppError(
      'CONFLICT',
      'no FX maker factory registered; call registerMakerFactory() at boot',
      503
    );
  }
  return _factory;
};
