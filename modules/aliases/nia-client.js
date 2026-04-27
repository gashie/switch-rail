// Pluggable NIA (Ghanacard) verification client.
// In production, mode='live' wires a real adapter to the NIA Persus endpoint.
// Phase 3 ships only the fake — same interface, deterministic responses for
// the curated set of test PINs documented in PHASE-3.md §B3.5.

const FAKE_REGISTRY = Object.freeze({
  'GHA-000000001-1': {
    firstName: 'KOFI',
    lastName: 'MENSAH',
    otherName: '',
    gender: 'M',
    dateOfBirth: '1985-03-15',
    address: 'East Legon, Accra'
  },
  'GHA-000000002-2': {
    firstName: 'AMA',
    lastName: 'OWUSU',
    otherName: '',
    gender: 'F',
    dateOfBirth: '1990-07-22',
    address: 'Kumasi, Ashanti'
  },
  'GHA-000000003-3': {
    firstName: 'KWAME',
    lastName: 'ASANTE',
    otherName: '',
    gender: 'M',
    dateOfBirth: '1978-11-04',
    address: 'Cape Coast, Central'
  }
});

const fieldsMatch = (claim, canonical) => ({
  firstName: !claim.firstName || claim.firstName.toUpperCase() === canonical.firstName,
  lastName: !claim.lastName || claim.lastName.toUpperCase() === canonical.lastName,
  dateOfBirth: !claim.dateOfBirth || claim.dateOfBirth === canonical.dateOfBirth
});

const fakeVerify = ({ ghanacardPin, firstName, lastName, dateOfBirth }) => {
  const canonical = FAKE_REGISTRY[String(ghanacardPin || '').toUpperCase()];
  if (!canonical) {
    return { status: 'NOT_FOUND', fields: {}, canonical: null };
  }
  const fields = fieldsMatch(
    { firstName, lastName, dateOfBirth },
    canonical
  );
  const supplied = [firstName, lastName, dateOfBirth].filter(Boolean).length;
  const matches = Object.values(fields).filter(Boolean).length;
  let status;
  if (supplied === 0) {
    status = 'EXACT_MATCH';
  } else if (matches === supplied) {
    status = 'EXACT_MATCH';
  } else if (matches >= 1) {
    status = 'PARTIAL_MATCH';
  } else {
    status = 'NO_MATCH';
  }
  return { status, fields, canonical };
};

export const createNiaClient = ({ mode = 'fake' } = {}) => {
  if (mode !== 'fake') {
    // The real adapter slot — lives in a future deferred-items branch.
    // Phase 3 only supports the fake. Trying to switch to live mode is an
    // operator misconfiguration: surface it loudly rather than silently
    // pretending to verify.
    return {
      verify: async () => {
        throw new Error(
          `NIA mode "${mode}" is not configured in this build. Set NIA_MODE=fake or wire a real adapter.`
        );
      }
    };
  }
  return {
    verify: async (claim) => fakeVerify(claim || {})
  };
};

export { FAKE_REGISTRY as NIA_FAKE_REGISTRY };
