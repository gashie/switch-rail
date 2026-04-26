import { writeFileSync } from 'node:fs';
import { config } from '../core/config.js';
import { closePool, query } from '../core/db.js';
import { authService } from '../modules/auth/index.js';
import { cryptoKeysService } from '../modules/crypto-keys/index.js';

const ADMIN_EMAIL = 'admin@sika.local';
const ADMIN_PASSWORD = 'admin1234';
const ADMIN_NAME = 'Admin';

const main = async () => {
  if (config.env === 'production') {
    throw new Error('seed.js is dev-only and refuses to run when NODE_ENV=production');
  }

  const summary = { admin: null, railKey: null };

  try {
    const u = await authService.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      name: ADMIN_NAME
    });
    summary.admin = { id: u.id, email: u.email, created: true };
  } catch (e) {
    if (e.code !== 'CONFLICT') throw e;
    const r = await query('SELECT id, email FROM users WHERE email = $1', [ADMIN_EMAIL]);
    summary.admin = { id: r.rows[0].id, email: r.rows[0].email, created: false };
  }

  const rk = await cryptoKeysService.ensureRailKey();
  summary.railKey = { kid: rk.kid, created: rk.created };

  writeFileSync('seed.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
};

main()
  .then(() => closePool())
  .catch((err) => {
    console.error(err.message || err);
    closePool().finally(() => process.exit(1));
  });
