import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Phase 5: file-based RTGS output. Real BoG hookup is a Phase 10 deferred
// item — the file is the integration point. Schema is documented inline so
// downstream tools (and the regulator) can consume it without reverse-
// engineering.

const HEADER = 'cycle_id,operating_date,currency,participant_code,direction,amount_minor';

const csvEscape = (s) => {
  const v = String(s ?? '');
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
};

export const buildRtgsCsv = ({ cycleId, operatingDate, currency, movements }) => {
  const lines = [HEADER];
  for (const m of movements) {
    const move = BigInt(m.movementMinor);
    const direction = move > 0n ? 'PARTICIPANT_PAYS_RAIL' : move < 0n ? 'RAIL_PAYS_PARTICIPANT' : 'NONE';
    const absMove = move < 0n ? -move : move;
    lines.push(
      [
        cycleId,
        operatingDate,
        currency,
        m.participantCode,
        direction,
        String(absMove)
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
};

export const writeRtgsCsv = ({ cycleId, operatingDate, currency, movements, outDir }) => {
  const dir = resolve(outDir || 'output/rtgs');
  mkdirSync(dir, { recursive: true });
  const csv = buildRtgsCsv({ cycleId, operatingDate, currency, movements });
  const path = `${dir}/${cycleId}-${currency}-${operatingDate}.csv`;
  // mkdir already ensures parent. dirname kept around for symmetry with the
  // override path branch below if a caller passes a fully-qualified file.
  void dirname;
  writeFileSync(path, csv, 'utf8');
  return { path, byteLength: Buffer.byteLength(csv, 'utf8'), lineCount: csv.trim().split('\n').length };
};
