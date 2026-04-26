import { uuidv7 } from '../../core/uuid.js';
import { AppError } from '../../core/errors.js';
import { parseCsv, rowToEnvelope } from './csv.js';
import { parseXlsx } from './xlsx.js';
import { parsePain001 } from './pain001.js';

export const createBulkService = ({ db, model, envelope }) => {
  const ingestBatch = async ({ sourceFormat, originatorParticipant, envelopes }) => {
    const batchId = uuidv7();
    const failures = [];
    let succeeded = 0;
    for (let i = 0; i < envelopes.length; i++) {
      const item = envelopes[i];
      if (item.error) {
        failures.push({ line: i + 1, error: String(item.error) });
        continue;
      }
      try {
        await envelope.ingest(item.envelope);
        succeeded += 1;
      } catch (e) {
        failures.push({ line: i + 1, error: e.message || String(e) });
      }
    }
    const summary = await db.withTransaction((c) =>
      model.insertBatch(c, {
        batchId,
        sourceFormat,
        originatorParticipant,
        total: envelopes.length,
        succeeded,
        failed: failures.length,
        failures
      })
    );
    return {
      batchId,
      total: envelopes.length,
      succeeded,
      failed: failures.length,
      failures,
      summary
    };
  };

  return {
    ingestCsv: async (buffer, { originatorParticipant } = {}) => {
      let rows;
      try {
        rows = parseCsv(buffer);
      } catch (e) {
        throw new AppError('VALIDATION_FAILED', `csv parse failed: ${e.message}`, 400);
      }
      const batchId = uuidv7();
      const envelopes = rows.map((row, idx) => {
        try {
          return { envelope: rowToEnvelope(row, { batchId, rowIndex: idx + 1 }) };
        } catch (e) {
          return { error: e.message || String(e) };
        }
      });
      const result = await ingestBatch({
        sourceFormat: 'BULK_CSV',
        originatorParticipant,
        envelopes
      });
      return result;
    },

    ingestXlsx: async (buffer, { originatorParticipant } = {}) => {
      let rows;
      try {
        rows = parseXlsx(buffer);
      } catch (e) {
        throw new AppError('VALIDATION_FAILED', `xlsx parse failed: ${e.message}`, 400);
      }
      const batchId = uuidv7();
      const envelopes = rows.map((row, idx) => {
        try {
          const env = rowToEnvelope(row, { batchId, rowIndex: idx + 1 });
          return { envelope: { ...env, sourceFormat: 'BULK_XLSX' } };
        } catch (e) {
          return { error: e.message || String(e) };
        }
      });
      return ingestBatch({
        sourceFormat: 'BULK_XLSX',
        originatorParticipant,
        envelopes
      });
    },

    ingestPain001: async (xml, { originatorParticipant } = {}) => {
      let parsed;
      try {
        parsed = parsePain001(String(xml));
      } catch (e) {
        throw new AppError('VALIDATION_FAILED', `pain.001 parse failed: ${e.message}`, 400);
      }
      const envelopes = parsed.map((env) => ({ envelope: env }));
      return ingestBatch({
        sourceFormat: 'BULK_PAIN001',
        originatorParticipant,
        envelopes
      });
    },

    getBatch: (batchId) => db.withClient((c) => model.getBatch(c, batchId))
  };
};
