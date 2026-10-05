import { randomInt } from 'node:crypto';

// Phone OTP client — fake provider for dev/test. The real provider would
// integrate with an SMS gateway (Hubtel, Twilio, etc.) and never expose the
// generated OTP back to the caller; the fake returns it so demo scripts
// and tests can exercise the consume path.

const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const OTP_MAX_ATTEMPTS = 3;

const generateOtp = () => {
  // randomInt(max) returns 0..max-1; we want a 6-digit code (0–999999) padded
  // with leading zeros when shorter.
  const n = randomInt(0, 10 ** OTP_LENGTH);
  return String(n).padStart(OTP_LENGTH, '0');
};

export const createOtpClient = ({ mode = 'fake' } = {}) => ({
  // sendOtp produces a fresh code. In fake mode we hand the code back so
  // callers can store it in the challenges table; in live mode the SMS
  // gateway delivers it to the phone and the rail only stores a hash.
  sendOtp: async ({ phone }) => {
    void phone;
    if (mode !== 'fake') {
      throw new Error(`OTP mode "${mode}" is not configured in this build`);
    }
    return { code: generateOtp(), ttlMs: OTP_TTL_MS, maxAttempts: OTP_MAX_ATTEMPTS };
  }
});
