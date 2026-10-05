import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { sha256 } from '../../core/crypto.js';
import { canonicalJsonBytes, canonicalJson } from '../../core/json.js';
import { auditService } from '../audit/index.js';
import { cryptoKeysService } from '../crypto-keys/index.js';
import { evidencePendingUntil } from './sla-clock.js';
import { STATES } from './states.js';

const GENESIS_PREV_HASH = '';

const findRailKid = async () => {
  const keys = await cryptoKeysService.listActive({ ownerType: 'rail', ownerId: null });
  if (keys.length === 0) {
    throw new AppError('CONFLICT', 'no active rail signing key', 503);
  }
  return keys[0].kid;
};

const evidenceMetadataPayload = ({ caseId, contentSha256, uploadedAt, side, evidenceType }) => ({
  caseId,
  contentSha256,
  uploadedAt: uploadedAt instanceof Date ? uploadedAt.toISOString() : uploadedAt,
  side,
  evidenceType
});

export const createEvidenceService = ({ db, evidenceModel, casesModel, disputesService }) => {
  const upload = async ({
    caseNumber,
    side,
    uploadedByParticipant,
    uploadedByUser,
    file,
    description
  }) => {
    if (!file || !file.buffer || !file.filename) {
      throw new AppError('VALIDATION_FAILED', 'evidence file required (buffer + filename)', 400);
    }
    return db.withTransaction(async (client) => {
      const c = await casesModel.findByCaseNumber(client, caseNumber);
      if (!c) throw new AppError('NOT_FOUND', `dispute case ${caseNumber} not found`, 404);
      if (c.state !== STATES.EVIDENCE_PENDING && c.state !== STATES.ADJUDICATING) {
        throw new AppError(
          'CONFLICT',
          `evidence upload not allowed in state ${c.state}; expected EVIDENCE_PENDING or ADJUDICATING`,
          409
        );
      }

      const contentSha256 = sha256(file.buffer);
      const sizeBytes = Buffer.isBuffer(file.buffer) ? file.buffer.length : Number(file.size || 0);
      const id = uuidv7();
      const uploadedAt = new Date();
      const railTimestamp = uploadedAt;

      // Cryptographic timestamping — sign canonicalJson({caseId, sha256, uploadedAt, side, evidenceType}).
      const railKid = await findRailKid();
      const sigPayload = evidenceMetadataPayload({
        caseId: c.id,
        contentSha256,
        uploadedAt: railTimestamp,
        side,
        evidenceType: file.evidenceType
      });
      const signed = await cryptoKeysService.sign({
        kid: railKid,
        payload: canonicalJsonBytes(sigPayload)
      });

      // Provenance chain: link to last evidence row for this case.
      const last = await evidenceModel.lastForCase(client, c.id);
      const prevHash = last ? last.evidence_chain_hash : GENESIS_PREV_HASH;
      const evidenceMetadataHash = sha256(
        canonicalJson({
          caseId: c.id,
          contentSha256,
          side,
          evidenceType: file.evidenceType,
          uploadedAt: railTimestamp.toISOString(),
          uploadedByParticipant: uploadedByParticipant ?? null
        })
      );
      const evidenceChainHash = sha256(`${prevHash}${evidenceMetadataHash}`);

      const inserted = await evidenceModel.insert(client, {
        id,
        caseId: c.id,
        side,
        uploadedByParticipant,
        uploadedByUser,
        evidenceType: file.evidenceType,
        filename: file.filename,
        contentSha256,
        contentSizeBytes: sizeBytes,
        mimeType: file.mimeType ?? null,
        description,
        railTimestamp: railTimestamp.toISOString(),
        railSignatureB64: signed.signature,
        railSignatureKid: railKid,
        prevEvidenceHash: prevHash,
        evidenceChainHash
      });

      await auditService.record(client, {
        actorType: uploadedByUser ? 'user' : 'system',
        actorId: uploadedByUser || null,
        eventType: 'dispute.evidence_uploaded',
        resourceType: 'dispute_evidence',
        resourceId: id,
        payload: {
          caseId: c.id,
          caseNumber,
          side,
          evidenceType: file.evidenceType,
          contentSha256,
          sizeBytes
        }
      });

      // Auto-progress check: if both FILER and RESPONDER have at least one
      // piece of evidence, transition EVIDENCE_PENDING -> ADJUDICATING.
      if (c.state === STATES.EVIDENCE_PENDING) {
        const sides = await evidenceModel.sidesPresentForCase(client, c.id);
        if (sides.FILER > 0 && sides.RESPONDER > 0) {
          await disputesService.transition(client, c.id, STATES.ADJUDICATING, {
            reason: 'EVIDENCE_COMPLETE',
            payload: { fields: { adjudicating_at: new Date().toISOString() }, sides },
            occurredBy: 'system'
          });
          await auditService.record(client, {
            actorType: 'system',
            eventType: 'dispute.evidence_complete',
            resourceType: 'dispute_case',
            resourceId: c.id,
            payload: { sides, autoProgressed: true }
          });
        }
      }

      return inserted;
    });
  };

  // Worker-style: scan EVIDENCE_PENDING cases whose deadlines elapsed and
  // force-progress to ADJUDICATING. Idempotent — running twice on the same
  // case is a no-op (state already ADJUDICATING).
  const expireWindowAndAdvance = (caseId) =>
    db.withTransaction(async (client) => {
      const c = await casesModel.findById(client, caseId);
      if (!c) throw new AppError('NOT_FOUND', `dispute ${caseId} not found`, 404);
      if (c.state !== STATES.EVIDENCE_PENDING) return { advanced: false, case: c };
      const deadline = c.evidence_pending_until ? new Date(c.evidence_pending_until) : null;
      if (deadline && Date.now() < deadline.getTime()) {
        return { advanced: false, case: c, reason: 'deadline_in_future' };
      }
      const updated = await disputesService.transition(client, c.id, STATES.ADJUDICATING, {
        reason: 'RESPONSE_WINDOW_EXPIRED',
        payload: { fields: { adjudicating_at: new Date().toISOString() }, deadlineIso: deadline?.toISOString() ?? null },
        occurredBy: 'system'
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'dispute.evidence_complete',
        resourceType: 'dispute_case',
        resourceId: c.id,
        payload: { reason: 'RESPONSE_WINDOW_EXPIRED' }
      });
      return { advanced: true, case: updated };
    });

  const listForCase = async ({ caseNumber, side }) => {
    const c = await db.withClient((cl) => casesModel.findByCaseNumber(cl, caseNumber));
    if (!c) return null;
    const items = await db.withClient((cl) => evidenceModel.listForCase(cl, { caseId: c.id, side }));
    return { case: c, items };
  };

  // Tamper detection: walk the chain and recompute each row's chain hash.
  const verifyChain = async (caseNumber) => {
    const c = await db.withClient((cl) => casesModel.findByCaseNumber(cl, caseNumber));
    if (!c) return { ok: false, reason: 'CASE_NOT_FOUND' };
    const items = await db.withClient((cl) => evidenceModel.listForCase(cl, { caseId: c.id }));
    let prev = GENESIS_PREV_HASH;
    for (const row of items) {
      const meta = sha256(
        canonicalJson({
          caseId: c.id,
          contentSha256: row.content_sha256,
          side: row.side,
          evidenceType: row.evidence_type,
          uploadedAt: row.rail_timestamp instanceof Date ? row.rail_timestamp.toISOString() : row.rail_timestamp,
          uploadedByParticipant: row.uploaded_by_participant ?? null
        })
      );
      const expected = sha256(`${prev}${meta}`);
      if (row.evidence_chain_hash !== expected || row.prev_evidence_hash !== prev) {
        return { ok: false, brokenAtId: row.id };
      }
      prev = row.evidence_chain_hash;
    }
    return { ok: true, count: items.length };
  };

  // Returns the signed payload that an external verifier can re-sign-check
  // using the rail's published Ed25519 public key.
  const signaturePayloadFor = async (id) => {
    const row = await db.withClient((cl) => evidenceModel.findById(cl, id));
    if (!row) return null;
    const payload = evidenceMetadataPayload({
      caseId: row.case_id,
      contentSha256: row.content_sha256,
      uploadedAt: row.rail_timestamp instanceof Date ? row.rail_timestamp.toISOString() : row.rail_timestamp,
      side: row.side,
      evidenceType: row.evidence_type
    });
    return {
      payload,
      payloadCanonical: canonicalJson(payload),
      signature: row.rail_signature_b64,
      kid: row.rail_signature_kid,
      uploadedAt: row.rail_timestamp,
      contentSha256: row.content_sha256
    };
  };

  return {
    upload,
    expireWindowAndAdvance,
    listForCase,
    verifyChain,
    signaturePayloadFor,
    // Re-export the per-reason deadline helper so demo + portal share one path.
    evidencePendingUntil
  };
};
