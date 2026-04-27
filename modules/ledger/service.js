import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { canonicalJson } from '../../core/json.js';
import { chainHash } from '../../core/crypto.js';
import { auditService } from '../audit/index.js';
import { ACCOUNT_TYPES, JOURNAL_REASONS, SIDES, accountCodeFor, ownerTypeFor } from './codes.js';

const GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';

// Position-update hook is wired by modules/settlement at boot. Keeping it as
// an injection point avoids a hard import cycle (settlement → ledger →
// settlement). The hook runs inside the same transaction as the journal
// insert so positions never lag the ledger.
let _onPostedHook = null;
export const registerOnPostedHook = (fn) => {
  _onPostedHook = fn;
};

const assertEntries = (entries) => {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new AppError(
      'VALIDATION_FAILED',
      'ledger journal requires at least two postings (double-entry)',
      400,
      { entriesLength: entries?.length ?? 0 }
    );
  }
};

const assertBalanced = (entries) => {
  const byCcy = new Map();
  for (const e of entries) {
    const cur = byCcy.get(e.currency) || { dr: 0n, cr: 0n };
    const amt = BigInt(e.amount);
    if (amt <= 0n) {
      throw new AppError('VALIDATION_FAILED', `posting amount must be positive: ${amt}`, 400);
    }
    if (e.side === 'DR') cur.dr += amt;
    else if (e.side === 'CR') cur.cr += amt;
    else throw new AppError('VALIDATION_FAILED', `unknown side: ${e.side}`, 400);
    byCcy.set(e.currency, cur);
  }
  for (const [ccy, sums] of byCcy.entries()) {
    if (sums.dr !== sums.cr) {
      throw new AppError(
        'VALIDATION_FAILED',
        `journal does not balance for ${ccy}: DR=${sums.dr} CR=${sums.cr}`,
        400,
        { currency: ccy, dr: String(sums.dr), cr: String(sums.cr) }
      );
    }
  }
};

const buildJournalPayload = ({ journalSeq, reason, operatingDate, referenceType, referenceId, entries }) => ({
  journalSeq: String(journalSeq),
  reason,
  operatingDate,
  referenceType: referenceType ?? null,
  referenceId: referenceId ?? null,
  entries: entries
    .slice()
    .sort((a, b) => a.postingSeq - b.postingSeq)
    .map((e) => ({
      postingSeq: e.postingSeq,
      accountCode: e.accountCode,
      side: e.side,
      amount: String(e.amount),
      currency: e.currency
    }))
});

export const createLedgerService = ({ db, model }) => {
  const ensureAccountOnClient = async (client, { accountType, ownerId, currency, metadata }) => {
    if (!Object.values(ACCOUNT_TYPES).includes(accountType)) {
      throw new AppError('VALIDATION_FAILED', `unknown accountType ${accountType}`, 400);
    }
    const code = accountCodeFor({ accountType, ownerId, currency });
    const existing = await model.findAccountByCode(client, code);
    if (existing) return existing;
    const inserted = await model.insertAccount(client, {
      id: uuidv7(),
      accountCode: code,
      accountType,
      ownerType: ownerTypeFor(accountType),
      ownerId: ownerId || null,
      currency,
      metadata: metadata || {}
    });
    if (inserted) return inserted;
    // ON CONFLICT happened between the existing-check and insert — refetch.
    const refetch = await model.findAccountByCode(client, code);
    if (!refetch) throw new AppError('INTERNAL', 'account vanished after insert race', 500);
    return refetch;
  };

  const postJournalOnClient = async (
    client,
    { reason, referenceType, referenceId, operatingDate, entries, metadata }
  ) => {
    if (!Object.values(JOURNAL_REASONS).includes(reason)) {
      throw new AppError('VALIDATION_FAILED', `unknown journal reason ${reason}`, 400);
    }
    if (!operatingDate) {
      throw new AppError('VALIDATION_FAILED', 'operatingDate is required', 400);
    }
    assertEntries(entries);
    assertBalanced(entries);

    // Verify each account exists and is active. Done in-loop so the error
    // message names the missing account.
    for (const e of entries) {
      const acc = await model.findAccountByCode(client, e.accountCode);
      if (!acc) {
        throw new AppError(
          'VALIDATION_FAILED',
          `account ${e.accountCode} does not exist`,
          400,
          { accountCode: e.accountCode }
        );
      }
      if (acc.status !== 'active') {
        throw new AppError(
          'CONFLICT',
          `account ${e.accountCode} is ${acc.status}`,
          409,
          { accountCode: e.accountCode, status: acc.status }
        );
      }
      if (acc.currency !== e.currency) {
        throw new AppError(
          'VALIDATION_FAILED',
          `posting currency ${e.currency} does not match account currency ${acc.currency}`,
          400
        );
      }
    }

    // Build the postings list with assigned posting_seq so the canonical
    // payload is stable regardless of caller order.
    const sequenced = entries.map((e, i) => ({ ...e, postingSeq: i }));

    // Hash chain: link to the last journal of the same operating date. Each
    // operating day has its own chain root (GENESIS) so closed days can be
    // verified independently.
    const last = await model.lastJournalForDate(client, operatingDate);
    const prevHash = last?.hash || GENESIS;

    const journalId = uuidv7();
    const inserted = await model.insertJournal(client, {
      id: journalId,
      operatingDate,
      reason,
      referenceType,
      referenceId,
      metadata: metadata || {},
      prevHash,
      // Placeholder — overwritten below once we know journal_seq.
      hash: 'pending'
    });

    // Now we have the canonical journal_seq from the BIGSERIAL, build the
    // payload, compute the real hash, and update.
    const payload = buildJournalPayload({
      journalSeq: inserted.journal_seq,
      reason,
      operatingDate,
      referenceType,
      referenceId,
      entries: sequenced
    });
    const hash = chainHash(prevHash, canonicalJson(payload));
    await model.updateJournalHash(client, journalId, hash);

    // Postings are inserted only after the hash is sealed.
    for (const e of sequenced) {
      await model.insertPosting(client, {
        id: uuidv7(),
        journalId,
        postingSeq: e.postingSeq,
        accountCode: e.accountCode,
        side: e.side,
        amountValue: e.amount,
        currency: e.currency
      });
    }

    await auditService.record(client, {
      actorType: 'system',
      eventType: 'ledger.journal_posted',
      resourceType: 'ledger_journal',
      resourceId: journalId,
      payload: {
        reason,
        operatingDate,
        referenceType: referenceType ?? null,
        referenceId: referenceId ?? null,
        entries: payload.entries.length,
        hash
      }
    });

    if (typeof _onPostedHook === 'function') {
      await _onPostedHook(client, journalId, sequenced);
    }

    return { journalId, hash, journalSeq: String(inserted.journal_seq) };
  };

  const balanceFor = (accountCode, { asOf } = {}) =>
    db.withClient(async (c) =>
      BigInt(await model.balanceForAccount(c, accountCode, asOf || null))
    );

  const journalById = (id) =>
    db.withClient(async (c) => {
      const journal = await model.findJournalById(c, id);
      if (!journal) return null;
      const postings = await model.listPostingsForJournal(c, id);
      return { journal, postings };
    });

  const journalsByReference = (referenceType, referenceId) =>
    db.withClient((c) => model.listJournalsByReference(c, referenceType, referenceId));

  const listAccounts = (filters) =>
    db.withClient((c) => model.listAccounts(c, filters || {}));

  const ensureAccount = (input) =>
    db.withTransaction((client) => ensureAccountOnClient(client, input));

  const verifyDayChain = (operatingDate) =>
    db.withClient(async (c) => {
      const journals = await model.listJournalsForDate(c, operatingDate);
      let prev = GENESIS;
      for (const j of journals) {
        if (j.prev_hash !== prev) {
          return { ok: false, brokenAtSeq: Number(j.journal_seq), reason: 'prev_hash mismatch' };
        }
        const postings = await model.listPostingsForJournal(c, j.id);
        const sequenced = postings.map((p) => ({
          postingSeq: p.posting_seq,
          accountCode: p.account_code,
          side: p.side,
          amount: String(p.amount_value),
          currency: p.currency
        }));
        const expected = chainHash(
          prev,
          canonicalJson(
            buildJournalPayload({
              journalSeq: j.journal_seq,
              reason: j.reason,
              operatingDate: j.operating_date instanceof Date
                ? j.operating_date.toISOString().slice(0, 10)
                : j.operating_date,
              referenceType: j.reference_type,
              referenceId: j.reference_id,
              entries: sequenced
            })
          )
        );
        if (expected !== j.hash) {
          return { ok: false, brokenAtSeq: Number(j.journal_seq), reason: 'hash mismatch' };
        }
        prev = j.hash;
      }
      return { ok: true, count: journals.length };
    });

  // Two call shapes:
  //   postJournal(client, input)  — caller owns the transaction (orchestrator)
  //   postJournal(input)          — service opens its own transaction
  const postJournal = (clientOrInput, maybeInput) => {
    if (clientOrInput && typeof clientOrInput.query === 'function') {
      return postJournalOnClient(clientOrInput, maybeInput);
    }
    return db.withTransaction((c) => postJournalOnClient(c, clientOrInput));
  };

  return {
    postJournal,
    balanceFor,
    journalById,
    journalsByReference,
    listAccounts,
    ensureAccount,
    verifyDayChain,
    SIDES,
    JOURNAL_REASONS,
    ACCOUNT_TYPES,
    accountCodeFor,
    _internal: {
      ensureAccountOnClient,
      postJournalOnClient
    }
  };
};
