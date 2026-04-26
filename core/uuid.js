import { randomBytes } from 'node:crypto';

// RFC 9562 UUIDv7:
//   bits   0..47  : unix_ts_ms (big-endian)
//   bits  48..51  : version (= 0b0111)
//   bits  52..63  : rand_a (12 bits)
//   bits  64..65  : variant (= 0b10)
//   bits  66..127 : rand_b (62 bits)
export const uuidv7 = () => {
  const ts = BigInt(Date.now());
  const buf = randomBytes(16);

  buf[0] = Number((ts >> 40n) & 0xffn);
  buf[1] = Number((ts >> 32n) & 0xffn);
  buf[2] = Number((ts >> 24n) & 0xffn);
  buf[3] = Number((ts >> 16n) & 0xffn);
  buf[4] = Number((ts >> 8n) & 0xffn);
  buf[5] = Number(ts & 0xffn);

  buf[6] = (buf[6] & 0x0f) | 0x70;
  buf[8] = (buf[8] & 0x3f) | 0x80;

  const hex = buf.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
