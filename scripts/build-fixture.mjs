// Helper invoked by demo scripts to materialize wire-format fixtures from
// the canonical JSON envelopes. Usage:
//   node scripts/build-fixture.mjs pacs008  <inJson> <outFile> <nonce>
//   node scripts/build-fixture.mjs iso8583 <inJson> <outFile> <nonce>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , kind, inFile, outFile, nonce] = process.argv;
if (!kind || !inFile || !outFile || !nonce) {
  console.error('usage: build-fixture.mjs <pacs008|iso8583> <inJson> <outFile> <nonce>');
  process.exit(1);
}

const json = JSON.parse(readFileSync(inFile, 'utf8'));
// Kind+nonce together drive the envelopeId so the same nonce can be reused
// across formats (eg one demo orchestrator runs all three sub-demos in
// quick succession) without colliding on the envelopes unique key. The
// resulting id has to satisfy the envelope schema's UUID v7 regex.
const tag = `${kind}${nonce}`.replace(/[^a-f0-9]/gi, '').toLowerCase();
const padded = (tag + 'a1b2c3d4e5f6').slice(0, 12);
const variant = `8${padded.slice(0, 3)}`; // [89ab][0-9a-f]{3}
json.envelopeId = `01900000-0000-7${padded.slice(3, 6)}-${variant}-${padded}`;
// The ISO 8583 STAN is derived from the digit-stripped sourceMessageId, so
// the kind+nonce alone (which often differ only in their leading letter)
// can collide across fixtures in the same demo run. Mix in digits derived
// from the input fixture file's basename so every fixture lands at a
// distinct STAN.
const fileTag = inFile
  .replace(/.*[/\\]/, '')
  .replace(/[^a-z0-9]/gi, '')
  .toLowerCase()
  .split('')
  .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 1_000_000, 0)
  .toString()
  .padStart(6, '0');
json.sourceMessageId = `p4-${kind}-${nonce}-${fileTag}`;
// ISO 8583 truncates endToEndId to 12 chars (DE 37 is fixed-12). A
// per-run prefix on the e2e survives that truncation so the duplicates
// authorization check doesn't fire across consecutive demo runs. Use
// fileTag (file-name-derived hash) plus a fragment of the timestamp so
// happy/insufficient fixtures within the same run get distinct e2es.
const e2eShortNonce = nonce.slice(-4);
json.endToEndId =
  kind === 'iso8583' ? `${fileTag}${e2eShortNonce}` : `p4-${kind}-e2e-${nonce}`;
json.idempotencyKey = `p4-${kind}-idem-${nonce}`;

if (kind === 'pacs008') {
  json.sourceFormat = 'ISO20022';
  json.originator = { ...json.originator, bic: 'DEMOGHACAAA' };
  json.beneficiary = {
    ...json.beneficiary,
    bic: json.beneficiary.participantCode === 'BANK_TEST' ? 'TESTGHACAAA' : 'DEMOGHACAAA'
  };
  const { formatPacs008Xml } = await import('../modules/adapters-iso20022/pacs008.formatter.js');
  writeFileSync(outFile, formatPacs008Xml(json));
} else if (kind === 'iso8583') {
  json.sourceFormat = 'ISO8583';
  const { format8583 } = await import('../modules/adapters-iso8583/formatter.js');
  writeFileSync(outFile, format8583(json, '1987', '0200'));
} else {
  console.error(`unknown fixture kind: ${kind}`);
  process.exit(1);
}
