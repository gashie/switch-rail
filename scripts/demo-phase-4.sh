#!/usr/bin/env bash
# Phase 4 — orchestrator that runs all three sub-demos in sequence
# (REST → ISO 20022 → ISO 8583). Each sub-demo boots its own server, so
# cleanup between them is implicit. Prints `PHASE 4 OK` on success.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# REST sub-demo also runs the full reset/migrate/seed for the whole run.
bash scripts/demo-phase-4-rest.sh

# ISO 20022 + ISO 8583 reuse the seeded DB; their own preludes don't reset.
bash scripts/demo-phase-4-iso20022.sh
bash scripts/demo-phase-4-iso8583.sh

echo
echo "PHASE 4 OK"
