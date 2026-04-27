import { AppError } from '../../core/errors.js';
import { uuidv7 } from '../../core/uuid.js';
import * as db from '../../core/db.js';
import { config } from '../../core/config.js';
import { auditService } from '../audit/index.js';

// Counter durability: separate-connection write that commits independently
// from any surrounding transaction. Pattern matches Phase 3 OTP attempts.
const recordPortalHitOnSeparateConnection = (model, { ip, endpoint }) =>
  db.withClient((c) => model.recordHit(c, { id: uuidv7(), ip, endpoint }));

const countPortalHitsLastMinute = (model, { ip, endpoint }) =>
  db.withClient((c) => model.countHitsSince(c, { ip, endpoint }));

export const createPortalModel = () => ({
  recordHit: async (client, { id, ip, endpoint }) => {
    await client.query(
      `INSERT INTO dispute_portal_hits (id, ip, endpoint) VALUES ($1, $2, $3)`,
      [id, ip, endpoint]
    );
  },
  countHitsSince: async (client, { ip, endpoint }) => {
    const r = await client.query(
      `SELECT count(*)::int AS n FROM dispute_portal_hits
        WHERE ip = $1 AND endpoint = $2 AND hit_at >= now() - interval '1 minute'`,
      [ip, endpoint]
    );
    return r.rows[0]?.n ?? 0;
  },
  insertComment: async (client, { id, caseId, authorKind, authorRef, body }) => {
    const r = await client.query(
      `INSERT INTO dispute_comments (id, case_id, author_kind, author_ref, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, case_id, author_kind, author_ref, body, created_at`,
      [id, caseId, authorKind, authorRef ?? null, body]
    );
    return r.rows[0];
  },
  listComments: async (client, caseId) => {
    const r = await client.query(
      `SELECT id, case_id, author_kind, author_ref, body, created_at
       FROM dispute_comments WHERE case_id = $1 ORDER BY created_at ASC`,
      [caseId]
    );
    return r.rows;
  },
  pruneOldHits: async (client) => {
    const r = await client.query(
      `DELETE FROM dispute_portal_hits WHERE hit_at < now() - interval '24 hours' RETURNING id`
    );
    return r.rowCount;
  }
});

export const createCustomerPortalService = ({
  db: dbm,
  casesModel,
  evidenceModel,
  portalModel
}) => {
  // Public-facing rate limit. Throws RATE_LIMITED when count >= cap.
  // Recording the hit happens BEFORE the cap check so a flood of requests
  // is also reflected even if the case lookup throws.
  const enforceRateLimit = async ({ ip, endpoint }) => {
    if (!ip) throw new AppError('VALIDATION_FAILED', 'client IP missing', 400);
    await recordPortalHitOnSeparateConnection(portalModel, { ip, endpoint });
    const n = await countPortalHitsLastMinute(portalModel, { ip, endpoint });
    if (n > config.disputesPortalRateLimitPerMin) {
      throw new AppError(
        'RATE_LIMITED',
        `portal rate limit exceeded: ${n} hits in last minute (cap ${config.disputesPortalRateLimitPerMin})`,
        429
      );
    }
  };

  // Lookup the case for the customer. Filer-side evidence visible. Returns
  // not-found (with 404) for both unknown case and fingerprint mismatch —
  // we never reveal that the case number exists when the fingerprint is wrong.
  const lookup = async ({ caseNumber, fingerprint, ip }) => {
    await enforceRateLimit({ ip, endpoint: 'lookup' });
    const c = await dbm.withClient((cl) => casesModel.findByCaseNumber(cl, caseNumber));
    if (!c || c.verification_fingerprint !== fingerprint) {
      return { found: false };
    }
    const items = await dbm.withClient((cl) =>
      evidenceModel.listForCase(cl, { caseId: c.id, side: 'FILER' })
    );
    const comments = await dbm.withClient((cl) => portalModel.listComments(cl, c.id));
    return {
      found: true,
      case: {
        caseNumber: c.case_number,
        reasonCode: c.reason_code,
        state: c.state,
        amountMinor: String(c.amount_minor),
        currency: c.currency,
        filedAt: c.filed_at,
        evidencePendingUntil: c.evidence_pending_until,
        outcome: c.outcome,
        outcomeNotes: c.outcome_notes,
        resolvedAt: c.resolved_at
      },
      evidence: items.map((e) => ({
        id: e.id,
        evidenceType: e.evidence_type,
        filename: e.filename,
        contentSha256: e.content_sha256,
        uploadedAt: e.uploaded_at,
        railTimestamp: e.rail_timestamp,
        railSignatureKid: e.rail_signature_kid
      })),
      comments
    };
  };

  // Customer adds a comment. Fingerprint must match; rate-limited per IP.
  const comment = async ({ caseNumber, fingerprint, ip, body }) => {
    await enforceRateLimit({ ip, endpoint: 'comment' });
    return dbm.withTransaction(async (client) => {
      const c = await casesModel.findByCaseNumber(client, caseNumber);
      if (!c || c.verification_fingerprint !== fingerprint) {
        throw new AppError('NOT_FOUND', 'case not found', 404);
      }
      const inserted = await portalModel.insertComment(client, {
        id: uuidv7(),
        caseId: c.id,
        authorKind: 'CUSTOMER',
        authorRef: c.filing_user_ref,
        body
      });
      await auditService.record(client, {
        actorType: 'system',
        eventType: 'dispute.portal_comment',
        resourceType: 'dispute_case',
        resourceId: c.id,
        payload: { commentId: inserted.id, ip }
      });
      return { comment: inserted };
    });
  };

  // Maintenance: prune hits older than 24h. Worker-style.
  const pruneOldHits = () => dbm.withTransaction((c) => portalModel.pruneOldHits(c));

  return { lookup, comment, pruneOldHits };
};
