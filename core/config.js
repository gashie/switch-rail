import 'dotenv/config';

const required = (key) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
};

export const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  databaseUrl: required('DATABASE_URL'),
  cookieSecret: required('COOKIE_SECRET'),
  encryptionKey: required('ENCRYPTION_KEY'),
  operatorName: process.env.OPERATOR_NAME || 'Sika',
  countryCode: process.env.COUNTRY_CODE || 'GH',
  currencyDefault: process.env.CURRENCY_DEFAULT || 'GHS',
  // standalone-mode ports for `node modules/<n>/server.js`
  authPort: Number(process.env.AUTH_PORT || 4001),
  auditPort: Number(process.env.AUDIT_PORT || 4002),
  cryptoKeysPort: Number(process.env.CRYPTO_KEYS_PORT || 4003)
});
