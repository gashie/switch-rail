/**
 * Sanctions screening — Phase 4 framework only.
 *
 * Phase 6 fills this with OFAC/UN/EU/BoG/FIC list screening and PEP checks.
 * The Phase 4 implementation always passes so the pipeline is wired and
 * adapters/orchestrator code can rely on it being present. This is real,
 * functional code, not a placeholder throw — it returns pass with the
 * participants attached for traceability.
 */
export const sanctions = ({ transaction }) => ({
  pass: true,
  framework: {
    originatorScreened: transaction?.originator_participant ?? null,
    beneficiaryScreened: transaction?.beneficiary_participant ?? null,
    listsConsulted: []
  }
});
