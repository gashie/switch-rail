import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './core/config.js';
import { attachContext } from './core/context.js';
import { errorHandler, sendOk } from './core/http.js';
import { authRoutes } from './modules/auth/index.js';
import { auditRoutes } from './modules/audit/index.js';
import { cryptoKeysRoutes } from './modules/crypto-keys/index.js';
import { envelopeRoutes } from './modules/envelope/index.js';
import { restRoutes } from './modules/adapters-rest/index.js';
import { iso20022Routes } from './modules/adapters-iso20022/index.js';
import { iso8583Routes } from './modules/adapters-iso8583/index.js';
import { swiftRoutes } from './modules/adapters-swift/index.js';
import { bulkRoutes } from './modules/adapters-bulk/index.js';
import { participantsRoutes } from './modules/participants/index.js';
import { participantOnboardingRoutes } from './modules/participant-onboarding/index.js';
import { directoryRoutes } from './modules/directory/index.js';
import { aliasesRoutes } from './modules/aliases/index.js';
import { nameEnquiryRoutes } from './modules/name-enquiry/index.js';
import { transactionsRoutes } from './modules/transactions/index.js';
import { routingRoutes } from './modules/routing/index.js';
import { participantSimulatorRoutes } from './modules/participant-simulator/index.js';
import { creditLegRoutes } from './modules/credit-leg/index.js';
import { transactionReceiptsRoutes } from './modules/transaction-receipts/index.js';
import { reversalsRoutes } from './modules/reversals/index.js';
import { ledgerRoutes } from './modules/ledger/index.js';
import { settlementRoutes } from './modules/settlement/index.js';
import { liquidityRoutes } from './modules/liquidity/index.js';
import { settlementCycleRoutes } from './modules/settlement-cycle/index.js';
import { eodRoutes } from './modules/eod/index.js';
import { reconciliationRoutes } from './modules/reconciliation/index.js';
import { feesRoutes } from './modules/fees/index.js';
import { fraudRoutes } from './modules/fraud/index.js';
import { sanctionsRoutes } from './modules/sanctions/index.js';
import { networkGraphRoutes } from './modules/network-graph/index.js';
import { fraudFlagsRoutes } from './modules/fraud-flags/index.js';
import { fastTrackReversalRoutes } from './modules/fast-track-reversal/index.js';
import { disputesRoutes } from './modules/disputes/index.js';
import { overlaysR2pRoutes } from './modules/overlays-r2p/index.js';
import { overlaysQrRoutes } from './modules/overlays-qr/index.js';
import { overlaysMandatesRoutes } from './modules/overlays-mandates/index.js';
import { overlaysBulkRoutes } from './modules/overlays-bulk/index.js';
import { overlaysCashoutRoutes } from './modules/overlays-cashout/index.js';
import { overlaysRefundsRoutes } from './modules/overlays-refunds/index.js';
import { overlaysEscrowRoutes } from './modules/overlays-escrow/index.js';
import { overlaysSplitRoutes } from './modules/overlays-split/index.js';
import {
  crossborderRailsRoutes,
  crossborderSimulatorRoutes
} from './modules/crossborder-rails/index.js';
import { crossborderFxRoutes } from './modules/crossborder-fx/index.js';
import { crossborderTxRoutes } from './modules/crossborder-tx/index.js';
import { crossborderTravelRuleRoutes } from './modules/crossborder-travel-rule/index.js';
import { settlementAssetsRoutes } from './modules/settlement-assets/index.js';
import { opsDashboardRoutes } from './modules/ops-dashboard/index.js';
import { regulatorConsoleRoutes } from './modules/regulator-console/index.js';
import { publicStatusRoutes } from './modules/public-status/index.js';
import { ussdGatewayRoutes } from './modules/ussd-gateway/index.js';

export const buildApp = () => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser(config.cookieSecret));
  app.use(attachContext);

  app.get('/health', (_req, res) =>
    sendOk(res, {
      operatorName: config.operatorName,
      countryCode: config.countryCode,
      currencyDefault: config.currencyDefault,
      status: 'up'
    })
  );

  app.use('/auth', authRoutes);
  app.use('/audit', auditRoutes);
  app.use('/crypto-keys', cryptoKeysRoutes);
  app.use('/envelope', envelopeRoutes);
  app.use('/adapters-rest', restRoutes);
  app.use('/adapters-iso20022', iso20022Routes);
  app.use('/adapters-iso8583', iso8583Routes);
  app.use('/adapters-swift', swiftRoutes);
  app.use('/adapters-bulk', bulkRoutes);
  app.use('/participants', participantsRoutes);
  app.use('/participant-onboarding', participantOnboardingRoutes);
  app.use('/directory', directoryRoutes);
  app.use('/aliases', aliasesRoutes);
  app.use('/name-enquiry', nameEnquiryRoutes);
  app.use('/transactions', transactionsRoutes);
  app.use('/routing', routingRoutes);
  app.use('/simulator', participantSimulatorRoutes);
  app.use('/credit-leg', creditLegRoutes);
  app.use('/transaction-receipts', transactionReceiptsRoutes);
  app.use('/reversals', reversalsRoutes);
  app.use('/ledger', ledgerRoutes);
  app.use('/settlement', settlementRoutes);
  app.use('/liquidity', liquidityRoutes);
  app.use('/settlement-cycle', settlementCycleRoutes);
  app.use('/eod', eodRoutes);
  app.use('/reconciliation', reconciliationRoutes);
  app.use('/fees', feesRoutes);
  app.use('/fraud', fraudRoutes);
  app.use('/sanctions', sanctionsRoutes);
  app.use('/network-graph', networkGraphRoutes);
  app.use('/fraud-flags', fraudFlagsRoutes);
  app.use('/fast-track-reversal', fastTrackReversalRoutes);
  app.use('/disputes', disputesRoutes);
  app.use('/r2p', overlaysR2pRoutes);
  app.use('/qr', overlaysQrRoutes);
  app.use('/mandates', overlaysMandatesRoutes);
  app.use('/bulk', overlaysBulkRoutes);
  app.use('/cashout', overlaysCashoutRoutes);
  app.use('/refunds-overlay', overlaysRefundsRoutes);
  app.use('/escrow', overlaysEscrowRoutes);
  app.use('/splits', overlaysSplitRoutes);
  // Phase 9 — cross-border native.
  app.use('/crossborder-rails', crossborderRailsRoutes);
  app.use('/simulator-foreign', crossborderSimulatorRoutes);
  app.use('/fx', crossborderFxRoutes);
  app.use('/crossborder-tx', crossborderTxRoutes);
  app.use('/crossborder-travel-rule', crossborderTravelRuleRoutes);
  app.use('/settlement-assets', settlementAssetsRoutes);
  // Phase 10 — UI-facing ops modules.
  app.use('/ops-dashboard', opsDashboardRoutes);
  app.use('/regulator-console', regulatorConsoleRoutes);
  app.use('/public-status', publicStatusRoutes);
  app.use('/ussd', ussdGatewayRoutes);
  app.use(errorHandler);

  return app;
};
