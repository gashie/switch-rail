export const ok = (data) => ({ ok: true, data });

export const fail = (code, message, details) => ({
  ok: false,
  error: { code, message, ...(details ? { details } : {}) }
});
