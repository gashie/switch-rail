// Phase 6 demo seed — invoked from scripts/demo-phase-6.sh once the rail is
// already migrated and the standard Phase 5 seed has run. Adds:
//   - sanctions provider entries (OFAC/UN/BoG/INTERNAL fakes incl. OSAMA TEST PERSON)
//   - default fraud rule packs (UNIVERSAL_BASELINE_V1, GHANA_TYPOLOGIES_V1)
//   - enables UNIVERSAL_BASELINE_V1 for the seeded P5BANK01/P5BANK02
// Idempotent — running twice produces the same row counts.

import { sanctionsService } from '../modules/sanctions/index.js';
import { fraudRulesService } from '../modules/fraud/index.js';
import { closePool } from '../core/db.js';

const main = async () => {
  const sanctions = await sanctionsService.seedFakeProviders();
  console.log(`sanctions: ${sanctions.total} entries (${JSON.stringify(sanctions.source)})`);

  const packs = await fraudRulesService.seedDefaultPacks(null);
  console.log(`fraud rule packs: ${packs.packs.length} pack(s), ${packs.rules.length} rule(s)`);

  for (const code of ['P5BANK01', 'P5BANK02']) {
    await fraudRulesService.enablePackForParticipant({
      participantCode: code,
      packCode: 'UNIVERSAL_BASELINE_V1',
      enabled: true
    });
  }
  console.log('UNIVERSAL_BASELINE_V1 enabled for P5BANK01 and P5BANK02');
};

main()
  .then(() => closePool())
  .catch((err) => {
    console.error(err);
    closePool().finally(() => process.exit(1));
  });
