import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { config } from '../../core/config.js';
import { auditService } from '../audit/index.js';

export const createReconService = ({ db, model, feedClient }) => {
  const runReconciliation = ({ participantCode, currency, operatingDate, runType }) =>
    db.withTransaction(async (client) => {
      const run = await model.insertRun(client, {
        id: uuidv7(),
        participantCode,
        currency,
        operatingDate,
        runType
      });

      // Pull both sides.
      const railRows = await model.railView(client, {
        participantCode,
        currency,
        operatingDate
      });
      const feedResult = await feedClient.fetch({
        participantCode,
        currency,
        operatingDate
      });
      const feedEntries = feedResult.entries || [];

      // Match by transaction id (the fake feed emits ref = rail tx id).
      const railById = new Map(railRows.map((r) => [r.id, r]));
      const feedByRef = new Map(feedEntries.map((e) => [e.ref, e]));

      let matched = 0;
      const breaks = [];
      for (const r of railRows) {
        const f = feedByRef.get(r.id);
        if (!f) {
          // The participant has no record. For CONFIRMED txns we mark
          // MISSING_AT_PARTICIPANT and (if old enough) write the audit
          // signal that triggers operator-driven adjustment.
          breaks.push({
            id: uuidv7(),
            runId: run.id,
            breakType: 'MISSING_AT_PARTICIPANT',
            railTransactionId: r.id,
            amountMinor: r.amount_value,
            currency: r.amount_currency,
            railState: r.state,
            participantState: null,
            notes: null
          });
          continue;
        }
        if (BigInt(r.amount_value) !== BigInt(f.amountMinor)) {
          breaks.push({
            id: uuidv7(),
            runId: run.id,
            breakType: 'AMOUNT_MISMATCH',
            railTransactionId: r.id,
            participantRef: f.ref,
            amountMinor: r.amount_value,
            currency: r.amount_currency,
            railState: r.state,
            participantState: f.state,
            notes: `rail=${r.amount_value} participant=${f.amountMinor}`
          });
          continue;
        }
        const railSemantic = r.state === 'CONFIRMED' ? 'credited' : r.state.toLowerCase();
        if (railSemantic !== f.state) {
          breaks.push({
            id: uuidv7(),
            runId: run.id,
            breakType: 'STATUS_MISMATCH',
            railTransactionId: r.id,
            participantRef: f.ref,
            amountMinor: r.amount_value,
            currency: r.amount_currency,
            railState: r.state,
            participantState: f.state,
            notes: null
          });
          continue;
        }
        matched += 1;
      }
      // Anything in the feed without a rail counterpart is MISSING_AT_RAIL.
      for (const f of feedEntries) {
        if (!railById.has(f.ref)) {
          breaks.push({
            id: uuidv7(),
            runId: run.id,
            breakType: 'MISSING_AT_RAIL',
            participantRef: f.ref,
            amountMinor: f.amountMinor,
            currency: f.currency,
            railState: null,
            participantState: f.state,
            notes: null
          });
        }
      }

      for (const b of breaks) {
        await model.insertBreak(client, b);
      }

      // Persist exhausted-recovery audit signal for old MISSING_AT_PARTICIPANT
      // breaks (per Phase 4 audit-event-then-operator-confirm rule).
      const ageWindowSeconds = config.reconBreakAgeSeconds;
      const cutoff = Date.now() - ageWindowSeconds * 1000;
      void cutoff; // Recovery worker uses age — recon currently flags all
                   // missing-at-participant breaks immediately; the
                   // adjustment audit lights up here for every MAP break.
      const adjustmentNeeded = breaks.filter((b) => b.breakType === 'MISSING_AT_PARTICIPANT');
      for (const b of adjustmentNeeded) {
        await auditService.record(client, {
          actorType: 'system',
          eventType: 'settlement.adjustment_needed',
          resourceType: 'transaction',
          resourceId: b.railTransactionId,
          payload: {
            runId: run.id,
            currency: b.currency,
            amountMinor: String(b.amountMinor || ''),
            participantCode,
            operatingDate
          }
        });
      }

      const completed = await model.completeRun(client, {
        id: run.id,
        totalCompared: railRows.length,
        totalMatched: matched,
        totalBreaks: breaks.length
      });
      return { run: completed, breaks: await model.listBreaksForRun(client, run.id) };
    });

  const findRun = (id) =>
    db.withClient(async (c) => {
      const run = await model.findRun(c, id);
      if (!run) return null;
      const breaks = await model.listBreaksForRun(c, id);
      return { run, breaks };
    });

  const listRuns = (filters) =>
    db.withClient((c) =>
      model.listRuns(c, {
        participantCode: filters.participantCode || null,
        currency: filters.currency || null,
        operatingDate: filters.operatingDate || null,
        runType: filters.runType || null,
        limit: filters.limit ?? 100
      })
    );

  const listBreaks = (filters) =>
    db.withClient((c) =>
      model.listBreaks(c, {
        resolution: filters.resolution || null,
        participantCode: filters.participantCode || null,
        limit: filters.limit ?? 100
      })
    );

  const resolveBreak = ({ id, resolution, notes, resolvedBy }) =>
    db.withTransaction(async (client) => {
      const updated = await model.resolveBreak(client, { id, resolution, notes, resolvedBy });
      if (!updated) {
        throw new AppError('NOT_FOUND', `break ${id} not found`, 404);
      }
      await auditService.record(client, {
        actorType: resolvedBy ? 'user' : 'system',
        actorId: resolvedBy || null,
        eventType: 'recon.break_resolved',
        resourceType: 'reconciliation_break',
        resourceId: id,
        payload: { resolution, notes }
      });
      return updated;
    });

  return {
    runReconciliation,
    findRun,
    listRuns,
    listBreaks,
    resolveBreak
  };
};
