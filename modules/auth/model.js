const USER_PUBLIC_COLS = 'id, email, name, status, created_at, updated_at';
const USER_AUTH_COLS = 'id, email, password_hash, name, status, created_at, updated_at';

export const createAuthModel = () => ({
  insertUser: async (client, { id, email, passwordHash, name }) => {
    const r = await client.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4) RETURNING ${USER_PUBLIC_COLS}`,
      [id, email, passwordHash, name]
    );
    return r.rows[0];
  },

  getUserByEmail: async (client, email) => {
    const r = await client.query(
      `SELECT ${USER_AUTH_COLS} FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    return r.rows[0] || null;
  },

  getUserById: async (client, id) => {
    const r = await client.query(
      `SELECT ${USER_PUBLIC_COLS} FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  getUserAuthById: async (client, id) => {
    const r = await client.query(
      `SELECT ${USER_AUTH_COLS} FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  updateUserPassword: async (client, id, passwordHash) => {
    const r = await client.query(
      `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1 RETURNING ${USER_PUBLIC_COLS}`,
      [id, passwordHash]
    );
    return r.rows[0] || null;
  },

  insertSession: async (client, { id, userId, expiresAt }) => {
    const r = await client.query(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3) RETURNING id, user_id, expires_at, created_at`,
      [id, userId, expiresAt]
    );
    return r.rows[0];
  },

  getSession: async (client, id) => {
    const r = await client.query(
      `SELECT id, user_id, expires_at, created_at FROM sessions WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  deleteSession: async (client, id) => {
    await client.query(`DELETE FROM sessions WHERE id = $1`, [id]);
    return { removed: true };
  },

  deleteUserSessions: async (client, userId) => {
    await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    return { removed: true };
  }
});
