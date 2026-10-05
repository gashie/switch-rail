import { randomBytes } from 'node:crypto';

export const EMAIL_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

const generateToken = () => randomBytes(24).toString('base64url');

export const createEmailLinkClient = ({ mode = 'fake' } = {}) => ({
  sendLink: async ({ email }) => {
    void email;
    if (mode !== 'fake') {
      throw new Error(`email-link mode "${mode}" is not configured in this build`);
    }
    return { token: generateToken(), ttlMs: EMAIL_TOKEN_TTL_MS };
  }
});
