import { config } from '../core/config.js';
import { query, closePool } from '../core/db.js';

const main = async () => {
  if (config.env === 'production') {
    throw new Error('reset.js is dev-only and refuses to run when NODE_ENV=production');
  }
  await query('DROP SCHEMA public CASCADE');
  await query('CREATE SCHEMA public');
  console.log('public schema dropped and recreated');
};

main()
  .then(() => closePool())
  .catch((err) => {
    console.error(err.message || err);
    closePool().finally(() => process.exit(1));
  });
