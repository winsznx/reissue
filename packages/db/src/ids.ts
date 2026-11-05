import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Time-ordered opaque id: prefix + 10 chars of millisecond time + 12 random chars (Crockford base32). */
export function newId(prefix: string): string {
  let time = Date.now();
  let head = "";
  for (let i = 0; i < 10; i++) {
    head = ALPHABET[time % 32] + head;
    time = Math.floor(time / 32);
  }
  const bytes = randomBytes(12);
  let tail = "";
  for (const b of bytes) tail += ALPHABET[b % 32];
  return `${prefix}_${head}${tail}`;
}
