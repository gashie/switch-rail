import { AppError } from '../../core/errors.js';
import { hashPassword, verifyPassword } from '../../core/crypto.js';
import { uuidv7 } from '../../core/uuid.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  status: u.status,
  created_at: u.created_at,
  updated_at: u.updated_at
});

export const createAuthService = ({ db, model }) => ({
  login: ({ email, password }) =>
    db.withTransaction(async (c) => {
      const user = await model.getUserByEmail(c, email);
      if (!user) throw new AppError('UNAUTHORIZED', 'invalid credentials', 401);
      const ok = await verifyPassword(user.password_hash, password);
      if (!ok) throw new AppError('UNAUTHORIZED', 'invalid credentials', 401);
      if (user.status !== 'active') {
        throw new AppError('UNAUTHORIZED', 'account is not active', 401);
      }
      const sessionId = uuidv7();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await model.insertSession(c, { id: sessionId, userId: user.id, expiresAt });
      return { sessionId, expiresAt, user: publicUser(user) };
    }),

  logout: (sessionId) =>
    db.withClient((c) => model.deleteSession(c, sessionId)),

  resolveSession: (sessionId) =>
    db.withClient(async (c) => {
      if (!sessionId) return null;
      const s = await model.getSession(c, sessionId);
      if (!s) return null;
      if (new Date(s.expires_at).getTime() <= Date.now()) {
        await model.deleteSession(c, s.id);
        return null;
      }
      const user = await model.getUserById(c, s.user_id);
      if (!user || user.status !== 'active') return null;
      return { sessionId: s.id, user: publicUser(user) };
    }),

  changePassword: ({ userId, current, next }) =>
    db.withTransaction(async (c) => {
      const user = await model.getUserAuthById(c, userId);
      if (!user) throw new AppError('UNAUTHORIZED', 'no such user', 401);
      const ok = await verifyPassword(user.password_hash, current);
      if (!ok) throw new AppError('UNAUTHORIZED', 'current password is incorrect', 401);
      const newHash = await hashPassword(next);
      const updated = await model.updateUserPassword(c, userId, newHash);
      await model.deleteUserSessions(c, userId);
      return { user: publicUser(updated) };
    }),

  createUser: ({ email, password, name }) =>
    db.withTransaction(async (c) => {
      const existing = await model.getUserByEmail(c, email);
      if (existing) throw new AppError('CONFLICT', 'email already registered', 409);
      const passwordHash = await hashPassword(password);
      const id = uuidv7();
      const user = await model.insertUser(c, { id, email, passwordHash, name });
      return publicUser(user);
    }),

  getUser: (id) => db.withClient((c) => model.getUserById(c, id))
});
