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
  currencyDefault: process.env.CURRENCY_DEFAULT || 'GHS'
});
