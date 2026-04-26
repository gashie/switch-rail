import { AppError } from '../../core/errors.js';

export const createRequireAuth = ({ service }) => async (req, _res, next) => {
  try {
    const sessionId = req.signedCookies?.sika_session;
    const resolved = await service.resolveSession(sessionId);
    if (!resolved) return next(new AppError('UNAUTHORIZED', 'authentication required', 401));
    req.ctx.user = resolved.user;
    req.ctx.sessionId = resolved.sessionId;
    next();
  } catch (e) {
    next(e);
  }
};
