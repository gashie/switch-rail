import { randomUUID } from 'node:crypto';

export const attachContext = (req, _res, next) => {
  req.ctx = {
    requestId: req.headers['x-request-id'] || randomUUID(),
    user: null,
    participantId: null
  };
  next();
};
