import { createHash } from 'node:crypto';
import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { transactionsOrchestrator } from '../transactions/index.js';
import { parseCsv, parseXlsx, parsePain001, rowToEnvelope } from '../adapters-bulk/index.js';
import { createEnvelope } from '../envelope/index.js';
import { RUN_STATES, LINE_STATES, OVERLAY_TYPE } from './codes.js';

const monthBucket = (d = new Date()) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

const formatRunNumber = (bucket, seq) => `BLK-${bucket}-${String(seq).padStart(6, '0')}`;

const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex');

// Parse the file once and produce a uniform envelope[] view. Each entry has
// either { envelope } or { error, lineNumber }.
const parseFileToEnvelopes = ({ buffer, sourceFormat, batchId }) => {
  if (sourceFormat === 'CSV') {
    const rows = parseCsv(buffer);
    return rows.map((row, idx) => {
      try {
        return { envelope: rowToEnvelope(row, { batchId, rowIndex: idx + 1 }), row };
      } catch (e) {
        return { error: e.message || String(e), row, lineNumber: idx + 1 };
      }
    });
  }
  if (sourceFormat === 'XLSX') {
    const rows = parseXlsx(buffer);
    return rows.map((row, idx) => {
      try {
        const env = rowToEnvelope(row, { batchId, rowIndex: idx + 1 });
        return { envelope: { ...env, sourceFormat: 'BULK_XLSX' }, row };
      } catch (e) {
        return { error: e.message || String(e), row, lineNumber: idx + 1 };
      }
    });
  }
  if (sourceFormat === 'PAIN001') {
    const parsed = parsePain001(buffer.toString('utf8'));
    return parsed.transactions.map((row, idx) => {
      try {
        return {
          envelope: createEnvelope({
            msgType: 'CRDT_TRF',
            sourceFormat: 'BULK_PAIN001',
            sourceMessageId: `${batchId}:${idx + 1}`,
            endToEndId: String(row.endToEndId || `${batchId}:${idx + 1}`),
            idempotencyKey: `bulk:${batchId}:${idx + 1}`,
            originator: row.originator,
            beneficiary: row.beneficiary,
            amount: row.amount,
            reference: row.reference
          }),
          row
        };
      } catch (e) {
        return { error: e.message || String(e), row, lineNumber: idx + 1 };
      }
    });
  }
  throw new AppError('VALIDATION_FAILED', `unknown sourceFormat ${sourceFormat}`, 400);
};

export const createOverlaysBulkService = ({ db, model }) => {
  const upload = async ({
    originatorParticipant,
    sourceFormat,
    sourceFilename,
    buffer,
    uploadedByUser
  }) => {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'buffer required', 400);
    }
    const sha = sha256Hex(buffer);

    // Idempotency: re-uploading the same file returns the existing run.
    const existing = await db.withClient((c) =>
      model.findRunBySha(c, { originatorParticipant, sourceSha256: sha })
    );
    if (existing) return { run: existing, deduped: true };

    const batchId = uuidv7();
    const items = parseFileToEnvelopes({ buffer, sourceFormat, batchId });
    const total = items.length;
    let totalAmount = 0n;
    for (const it of items) {
      if (it.envelope) totalAmount += BigInt(it.envelope.amount.value);
    }
    const firstEnv = items.find((it) => it.envelope)?.envelope;
    const currency = firstEnv?.amount.currency || 'GHS';
    // Bulk semantics: a single originator account per file (the canonical
    // payroll/disbursement pattern). Store it in metadata so the runner can
    // rebuild envelopes when processing each line.
    const runMetadata = firstEnv
      ? {
          originatorAccount: firstEnv.originator.accountId,
          originatorAccountType: firstEnv.originator.accountType,
          originatorName: firstEnv.originator.name
        }
      : {};

    const run = await db.withTransaction(async (client) => {
      const bucket = monthBucket();
      const seq = await model.bumpSequence(client, bucket);
      const id = uuidv7();
      const inserted = await model.insertRun(client, {
        id,
        runNumber: formatRunNumber(bucket, seq),
        originatorParticipant,
        sourceFormat,
        sourceFilename,
        sourceSha256: sha,
        totalLines: total,
        totalAmountMinor: String(totalAmount),
        currency,
        uploadedByUser,
        metadata: runMetadata
      });
      // Two-stage idempotency: ON CONFLICT DO NOTHING returned no row when a
      // concurrent uploader committed first. Re-fetch.
      const runRow = inserted || await model.findRunBySha(client, { originatorParticipant, sourceSha256: sha });

      // Insert lines.
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i];
        const env = it.envelope;
        await model.insertLine(client, {
          id: uuidv7(),
          runId: runRow.id,
          lineNumber: i + 1,
          amountMinor: env ? String(env.amount.value) : '0',
          beneficiaryParticipant: env ? env.beneficiary.participantCode : 'UNKNOWN',
          beneficiaryAccount: env ? env.beneficiary.accountId : 'UNKNOWN'
        });
        if (it.error) {
          await model.setLineResult(client, {
            runId: runRow.id,
            lineNumber: i + 1,
            state: LINE_STATES.FAILED,
            resultCode: 'PARSE_ERROR',
            resultMessage: it.error
          });
        }
      }

      await auditService.record(client, {
        actorType: 'system',
        eventType: 'bulk.uploaded',
        resourceType: 'bulk_payment_run',
        resourceId: runRow.id,
        payload: { runNumber: runRow.run_number, totalLines: total, sha }
      });
      return runRow;
    });

    return { run, deduped: false, items };
  };

  // Process a batch of pending lines through the orchestrator. Returns
  // counters. Caller can keep invoking until no more PENDING.
  const processBatch = async ({ runId, batchSize = 10 }) => {
    const run = await db.withClient((c) => model.findRunById(c, runId));
    if (!run) throw new AppError('NOT_FOUND', `run ${runId} not found`, 404);
    if (run.state === RUN_STATES.COMPLETED || run.state === RUN_STATES.FAILED || run.state === RUN_STATES.PARTIAL) {
      return { processed: 0, terminal: true, run };
    }
    if (run.state === RUN_STATES.QUEUED) {
      await db.withTransaction((c) =>
        model.setRunState(c, {
          id: run.id,
          state: RUN_STATES.RUNNING,
          fields: { started_at: new Date().toISOString() }
        })
      );
    }

    // Pick a batch of pending lines, lock them.
    const pending = await db.withTransaction(async (client) => {
      const lines = await model.pickPendingLines(client, { runId, limit: batchSize });
      for (const l of lines) {
        await model.setLineResult(client, {
          runId,
          lineNumber: l.line_number,
          state: LINE_STATES.PROCESSING,
          envelopeId: null,
          transactionId: null,
          resultCode: null,
          resultMessage: null
        });
      }
      return lines;
    });
    if (pending.length === 0) {
      // No more work — close the run.
      const counts = await db.withClient((c) => model.countLineStates(c, runId));
      const finalState =
        counts.SUCCEEDED === run.total_lines
          ? RUN_STATES.COMPLETED
          : counts.FAILED === run.total_lines
            ? RUN_STATES.FAILED
            : counts.SUCCEEDED + counts.FAILED === run.total_lines
              ? RUN_STATES.PARTIAL
              : run.state;
      const updatedRun = await db.withTransaction((c) =>
        model.setRunState(c, {
          id: runId,
          state: finalState,
          fields: {
            succeeded_count: counts.SUCCEEDED,
            failed_count: counts.FAILED,
            succeeded_amount_minor: counts.sumByState.SUCCEEDED || '0',
            failed_amount_minor: counts.sumByState.FAILED || '0',
            completed_at: finalState === run.state ? null : new Date().toISOString()
          }
        })
      );
      return { processed: 0, terminal: true, run: updatedRun };
    }

    // Re-build envelopes from the original file content. For Phase 8 we
    // re-parse the originator participant + amount + beneficiary from the
    // line row; the bulk_payment_lines table caries the canonical fields.
    const originatorParticipant = run.originator_participant;
    let succeeded = 0;
    let failed = 0;
    for (const l of pending) {
      const envelope = createEnvelope({
        msgType: 'CRDT_TRF',
        sourceFormat: 'REST',
        sourceMessageId: `bulk-${runId.slice(0, 8)}-${l.line_number}`,
        endToEndId: `bulk-${runId.slice(0, 8)}-${l.line_number}`,
        idempotencyKey: `bulk:${runId}:${l.line_number}`,
        originator: {
          participantCode: originatorParticipant,
          accountId: run.metadata?.originatorAccount || run.metadata?.fromAccount || `BULK-${originatorParticipant}`,
          accountType: 'BANK_ACCOUNT',
          name: run.metadata?.originatorName || originatorParticipant,
          countryCode: 'GH'
        },
        beneficiary: {
          participantCode: l.beneficiary_participant,
          accountId: l.beneficiary_account,
          accountType: 'BANK_ACCOUNT',
          name: run.metadata?.beneficiariesNamed || `BULK-${l.beneficiary_participant}-${l.beneficiary_account}`,
          countryCode: 'GH'
        },
        amount: { value: String(l.amount_minor), currency: run.currency },
        reference: `Bulk ${run.run_number} line ${l.line_number}`,
        purposeCode: 'GDDS',
        settlementMethod: 'CLRG',
        metadata: { overlay: { type: OVERLAY_TYPE, overlayId: runId, runNumber: run.run_number, lineNumber: l.line_number } }
      });
      let result;
      try {
        const orch = await transactionsOrchestrator.process(envelope);
        const tx = orch.transaction;
        const ok = tx.state === 'CONFIRMED';
        if (ok) succeeded += 1;
        else failed += 1;
        await db.withTransaction((c) =>
          model.setLineResult(c, {
            runId,
            lineNumber: l.line_number,
            state: ok ? LINE_STATES.SUCCEEDED : LINE_STATES.FAILED,
            envelopeId: envelope.envelopeId,
            transactionId: tx.id,
            resultCode: tx.reason_code || (ok ? 'SUCCESS' : 'TX_FAILED'),
            resultMessage: ok ? null : `tx state=${tx.state}`
          })
        );
        result = { lineNumber: l.line_number, ok, txId: tx.id };
      } catch (e) {
        failed += 1;
        await db.withTransaction((c) =>
          model.setLineResult(c, {
            runId,
            lineNumber: l.line_number,
            state: LINE_STATES.FAILED,
            envelopeId: null,
            transactionId: null,
            resultCode: 'ORCH_ERROR',
            resultMessage: e?.message || String(e)
          })
        );
        result = { lineNumber: l.line_number, ok: false, error: e?.message || String(e) };
      }
      void result;
    }
    void succeeded;
    void failed;

    // Recompute and store the run aggregates.
    const counts = await db.withClient((c) => model.countLineStates(c, runId));
    const allDone = counts.PENDING === 0 && counts.PROCESSING === 0;
    const finalState = !allDone
      ? RUN_STATES.RUNNING
      : counts.SUCCEEDED === run.total_lines
        ? RUN_STATES.COMPLETED
        : counts.FAILED === run.total_lines
          ? RUN_STATES.FAILED
          : RUN_STATES.PARTIAL;
    const updatedRun = await db.withTransaction((c) =>
      model.setRunState(c, {
        id: runId,
        state: finalState,
        fields: {
          succeeded_count: counts.SUCCEEDED,
          failed_count: counts.FAILED,
          succeeded_amount_minor: counts.sumByState.SUCCEEDED || '0',
          failed_amount_minor: counts.sumByState.FAILED || '0',
          completed_at: allDone ? new Date().toISOString() : null
        }
      })
    );
    return { processed: pending.length, terminal: allDone, run: updatedRun, counts };
  };

  // Run to completion: keeps batching until no PENDING remains.
  const runToCompletion = async ({ runId, batchSize }) => {
    let processed = 0;
    while (true) {
      const r = await processBatch({ runId, batchSize });
      processed += r.processed;
      if (r.terminal) return { processed, run: r.run };
    }
  };

  const findRunByNumber = (n) => db.withClient((c) => model.findRunByNumber(c, n));
  const findRunById = (id) => db.withClient((c) => model.findRunById(c, id));
  const listRuns = (filters) => db.withClient((c) => model.listRuns(c, filters));
  const listLines = (runId, limit) => db.withClient((c) => model.listLines(c, runId, limit));

  return { upload, processBatch, runToCompletion, findRunByNumber, findRunById, listRuns, listLines };
};
