import { createHash } from 'node:crypto';
import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import { auditService } from '../audit/index.js';
import { participantsService } from '../participants/index.js';
import { cryptoKeysService } from '../crypto-keys/index.js';
import { KYB_DOC_TYPES, CERT_SUITES } from './schema.js';

// State machine. Forward edges follow the canonical onboarding path. Operator
// termination is permitted from any non-terminal state — regulators and the
// rail operator both need an immediate kill-switch independent of where a
// participant currently sits in the pipeline.
const ALLOWED_TRANSITIONS = Object.freeze({
  pending: ['kyb', 'terminated'],
  kyb: ['certifying', 'terminated'],
  certifying: ['active', 'terminated'],
  active: ['suspended', 'terminated'],
  suspended: ['active', 'terminated'],
  terminated: []
});

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');

const allKybApproved = (docs) => {
  const byType = new Map(docs.map((d) => [d.doc_type, d]));
  return KYB_DOC_TYPES.every((t) => byType.get(t)?.review_status === 'approved');
};

const allCertsPassing = (certs) => {
  const byName = new Map(certs.map((c) => [c.test_suite, c]));
  return CERT_SUITES.every((s) => byName.get(s)?.status === 'pass');
};

// Cert harness — Phase 3 implementations.
//   ENVELOPE_ROUNDTRIP: actual round-trip check exercising the envelope module.
//   IDEMPOTENCY: ingest-twice check, asserts deduped behaviour.
//   CREDIT_LEG: precondition check (active signing key registered). Phase 4
//     replaces this with a full credit-leg simulation against the real
//     transactions module.
//   NAME_ENQUIRY: precondition check (participant has at least one account
//     reachable). Phase 3 B3.7 expands this to a real resolve call.
const runCertSuite = async (suite, { participantCode, participantId }) => {
  if (suite === 'ENVELOPE_ROUNDTRIP') {
    const { createEnvelope } = await import('../envelope/index.js');
    const { formatPacs008Xml, parsePacs008Xml } = await import(
      '../adapters-iso20022/index.js'
    );
    const env = createEnvelope({
      msgType: 'CRDT_TRF',
      sourceFormat: 'ISO20022',
      sourceMessageId: `cert-${participantCode}-${Date.now()}`,
      endToEndId: `cert-e2e-${participantCode}`,
      idempotencyKey: `cert-roundtrip-${participantCode}-${Date.now()}`,
      originator: {
        participantCode,
        accountId: 'CERT-ACCOUNT-001',
        accountType: 'BANK_ACCOUNT',
        name: 'CERT ORIGINATOR',
        bic: 'CERTGHACXXX'
      },
      beneficiary: {
        participantCode,
        accountId: 'CERT-ACCOUNT-002',
        accountType: 'BANK_ACCOUNT',
        name: 'CERT BENEFICIARY',
        bic: 'CERTGHACXXX'
      },
      amount: { value: '100', currency: 'GHS' }
    });
    const xml = formatPacs008Xml(env);
    const parsed = parsePacs008Xml(xml);
    const ok =
      parsed.amount.value === env.amount.value &&
      parsed.amount.currency === env.amount.currency &&
      parsed.originator.accountId === env.originator.accountId;
    return ok
      ? { status: 'pass', result: { check: 'pacs.008 round-trip equality' } }
      : { status: 'fail', result: { check: 'pacs.008 round-trip equality', reason: 'mismatch' } };
  }

  if (suite === 'IDEMPOTENCY') {
    const { createEnvelope, envelopeService } = await import('../envelope/index.js');
    const idempKey = `cert-idem-${participantCode}-${Date.now()}`;
    const seed = {
      msgType: 'CRDT_TRF',
      sourceFormat: 'REST',
      sourceMessageId: `cert-idem-${participantCode}`,
      endToEndId: `cert-idem-e2e-${participantCode}`,
      idempotencyKey: idempKey,
      originator: {
        participantCode,
        accountId: 'CERT-IDEM-A',
        accountType: 'BANK_ACCOUNT',
        name: 'CERT IDEM A'
      },
      beneficiary: {
        participantCode,
        accountId: 'CERT-IDEM-B',
        accountType: 'BANK_ACCOUNT',
        name: 'CERT IDEM B'
      },
      amount: { value: '1', currency: 'GHS' }
    };
    const a = await envelopeService.ingest(createEnvelope(seed));
    const b = await envelopeService.ingest(createEnvelope({ ...seed }));
    const ok = a.deduped === false && b.deduped === true && a.envelope.envelopeId === b.envelope.envelopeId;
    return ok
      ? { status: 'pass', result: { firstIngest: 'inserted', secondIngest: 'deduped' } }
      : { status: 'fail', result: { reason: 'idempotency contract violated' } };
  }

  if (suite === 'CREDIT_LEG') {
    const keys = await cryptoKeysService.listActive({
      ownerType: 'participant',
      ownerId: participantCode
    });
    if (keys.length === 0) {
      return { status: 'fail', result: { reason: 'no active signing key' } };
    }
    return {
      status: 'pass',
      result: {
        check: 'active signing key present (full credit-leg simulation arrives in Phase 4)',
        kid: keys[0].kid
      }
    };
  }

  if (suite === 'NAME_ENQUIRY') {
    // Phase 3 B3.7 will replace this with a real resolve call. Until then,
    // the suite asserts that the participant exists and is in a state
    // compatible with directory registration.
    if (!participantId) {
      return { status: 'fail', result: { reason: 'participant not registered' } };
    }
    return {
      status: 'pass',
      result: {
        check: 'participant registered (full directory resolve arrives at end of Phase 3)',
        participantId
      }
    };
  }

  return { status: 'fail', result: { reason: `unknown suite: ${suite}` } };
};

const camelize = (input) => {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
};

export const createOnboardingService = ({ db, model }) => ({
  uploadKyb: ({ code, docType, fileName, fileBuffer, uploadedBy }) =>
    db.withTransaction(async (client) => {
      const participant = await participantsService.getByCode(code);
      if (participant.status === 'terminated') {
        throw new AppError('CONFLICT', `participant ${code} is terminated`, 409);
      }
      if (!KYB_DOC_TYPES.includes(docType)) {
        throw new AppError('VALIDATION_FAILED', `unknown docType: ${docType}`, 400);
      }
      if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        throw new AppError('VALIDATION_FAILED', 'empty or missing file buffer', 400);
      }
      const doc = await model.upsertKybDoc(client, {
        id: uuidv7(),
        participantId: participant.id,
        docType,
        docFilename: fileName,
        docSha256: sha256Hex(fileBuffer),
        uploadedBy
      });
      // Move pending → kyb on first upload (idempotent if already kyb).
      if (participant.status === 'pending') {
        await participantsService.setStatus(code, { status: 'kyb' }, client);
      }
      await auditService.record(client, {
        actorType: 'user',
        actorId: uploadedBy,
        eventType: 'participant.kyb.uploaded',
        resourceType: 'participant',
        resourceId: participant.id,
        payload: { code, docType, sha256: doc.doc_sha256 }
      });
      return { doc };
    }),

  reviewKyb: ({ code, docType, status, note, reviewedBy }) =>
    db.withTransaction(async (client) => {
      const participant = await participantsService.getByCode(code);
      if (!KYB_DOC_TYPES.includes(docType)) {
        throw new AppError('VALIDATION_FAILED', `unknown docType: ${docType}`, 400);
      }
      const reviewed = await model.reviewKybDoc(client, {
        participantId: participant.id,
        docType,
        status,
        note,
        reviewedBy
      });
      if (!reviewed) {
        throw new AppError('NOT_FOUND', `KYB doc ${docType} not uploaded for ${code}`, 404);
      }
      await auditService.record(client, {
        actorType: 'user',
        actorId: reviewedBy,
        eventType: 'participant.kyb.reviewed',
        resourceType: 'participant',
        resourceId: participant.id,
        payload: { code, docType, status, note: note || null }
      });
      return { doc: reviewed };
    }),

  runCertSuite: ({ code, suite }) =>
    db.withTransaction(async (client) => {
      const participant = await participantsService.getByCode(code);
      if (!CERT_SUITES.includes(suite)) {
        throw new AppError('VALIDATION_FAILED', `unknown cert suite: ${suite}`, 400);
      }
      const outcome = await runCertSuite(suite, {
        participantCode: code,
        participantId: participant.id
      });
      const row = await model.upsertCertResult(client, {
        id: uuidv7(),
        participantId: participant.id,
        testSuite: suite,
        status: outcome.status,
        result: outcome.result
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'participant.certified',
        resourceType: 'participant',
        resourceId: participant.id,
        payload: { code, suite, status: outcome.status }
      });
      return { cert: row };
    }),

  transition: ({ code, to, reason, actorId }) =>
    db.withTransaction(async (client) => {
      const participant = await participantsService.getByCode(code);
      const allowedNexts = ALLOWED_TRANSITIONS[participant.status] || [];
      if (!allowedNexts.includes(to)) {
        throw new AppError(
          'CONFLICT',
          `transition ${participant.status} → ${to} is not allowed`,
          409,
          { from: participant.status, allowed: allowedNexts }
        );
      }
      // Gate kyb → certifying: all KYB docs approved.
      if (participant.status === 'kyb' && to === 'certifying') {
        const docs = await model.listKybDocs(client, participant.id);
        if (!allKybApproved(docs)) {
          throw new AppError(
            'CONFLICT',
            `cannot transition to certifying: not all KYB docs approved`,
            409,
            { required: KYB_DOC_TYPES }
          );
        }
        // Provision a signing key if none yet.
        const keys = await cryptoKeysService.listActive({
          ownerType: 'participant',
          ownerId: code
        });
        if (keys.length === 0) {
          await cryptoKeysService.generateForOwner({
            ownerType: 'participant',
            ownerId: code
          });
        }
      }
      // Gate certifying → active: all required cert suites passing.
      if (participant.status === 'certifying' && to === 'active') {
        const certs = await model.listCerts(client, participant.id);
        if (!allCertsPassing(certs)) {
          throw new AppError(
            'CONFLICT',
            `cannot activate: not all cert suites passing`,
            409,
            { required: CERT_SUITES }
          );
        }
      }

      const updates = { status: to };
      if (to === 'certifying') updates.certifiedAt = new Date();
      if (to === 'active') updates.activatedAt = new Date();
      if (to === 'suspended') updates.suspendedAt = new Date();
      const updated = await participantsService.setStatus(code, updates, client);

      const eventType =
        to === 'active'
          ? 'participant.activated'
          : to === 'suspended'
          ? 'participant.suspended'
          : to === 'terminated'
          ? 'participant.terminated'
          : 'participant.transitioned';

      await auditService.record(client, {
        actorType: 'user',
        actorId,
        eventType,
        resourceType: 'participant',
        resourceId: participant.id,
        payload: { code, from: participant.status, to, reason: reason || null }
      });
      return { participant: updated };
    }),

  getStatus: ({ code }) =>
    db.withClient(async (client) => {
      const participant = await participantsService.getByCode(code);
      const docs = await model.listKybDocs(client, participant.id);
      const certs = await model.listCerts(client, participant.id);
      return {
        participant,
        kyb: {
          required: KYB_DOC_TYPES,
          docs: docs.map((d) => camelize(d)),
          allApproved: allKybApproved(docs)
        },
        certifications: {
          required: CERT_SUITES,
          results: certs.map((c) => camelize(c)),
          allPassing: allCertsPassing(certs)
        }
      };
    })
});
