import { sendOk, setSessionCookie, clearSessionCookie } from '../../core/http.js';

const COOKIE_NAME = 'sika_session';

export const createAuthController = ({ service }) => ({
  login: async (req, res) => {
    const { sessionId, expiresAt, user } = await service.login(req.body);
    setSessionCookie(res, COOKIE_NAME, sessionId, {
      expires: new Date(expiresAt)
    });
    sendOk(res, { user });
  },

  logout: async (req, res) => {
    const sessionId = req.signedCookies?.[COOKIE_NAME];
    if (sessionId) await service.logout(sessionId);
    clearSessionCookie(res, COOKIE_NAME);
    sendOk(res, { logout: true });
  },

  me: async (req, res) => {
    sendOk(res, { user: req.ctx.user });
  },

  changePassword: async (req, res) => {
    const { current, new: next } = req.body;
    const result = await service.changePassword({ userId: req.ctx.user.id, current, next });
    clearSessionCookie(res, COOKIE_NAME);
    sendOk(res, result);
  }
});
