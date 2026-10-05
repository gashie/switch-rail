// Adds a single user credential to the rail. Used for spinning up demo
// logins without re-running the full seed.
//
// Usage:
//   node scripts/add-credential.js <email> <password> [name]
//
// Example:
//   node scripts/add-credential.js operator@demo.local op-pass-2026 "Demo operator"

import { closePool } from '../core/db.js';
import { authService } from '../modules/auth/index.js';

const [, , emailArg, passwordArg, ...nameParts] = process.argv;
const email = (emailArg || '').trim();
const password = (passwordArg || '').trim();
const name = (nameParts.join(' ') || email.split('@')[0]).trim();

if (!email || !password) {
  console.error('Usage: node scripts/add-credential.js <email> <password> [name]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const main = async () => {
  try {
    const user = await authService.createUser({ email, password, name });
    console.log(`Created user ${user.email} (id ${user.id})`);
    console.log('Log in via:');
    console.log(`  curl -c /tmp/c -X POST http://localhost:3000/auth/login \\`);
    console.log(`    -H 'content-type: application/json' \\`);
    console.log(`    -d '{"email":"${email}","password":"${password}"}'`);
  } finally {
    await closePool();
  }
};

main().catch((e) => {
  if (e?.code === 'CONFLICT') {
    console.error(`User ${email} already exists. Pick a different email or rotate the password through /auth/change-password while logged in.`);
  } else {
    console.error(e?.stack || e?.message || e);
  }
  process.exit(1);
});
