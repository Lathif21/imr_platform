/**
 * Password hashing in Better Auth's scrypt format — hex(salt) ":" hex(key),
 * N=16384 r=16 p=1, 64-byte key — so accounts moved from Neon Auth keep
 * logging in with the password they already have.
 *
 * No SvelteKit imports: scripts/buat-direksi.ts uses this too.
 */

import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 };
const KEY_LENGTH = 64;

/** Better Auth hashes the hex string of the salt, not its bytes. */
const deriveKey = (password: string, salt: string) => scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT);

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await deriveKey(password, salt)).toString('hex')}`;
}

/** A hash that never matches, so an unknown email costs as much as a wrong password. */
const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(KEY_LENGTH * 2)}`;

/** `stored` null still spends the full scrypt, then answers false. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [salt, key] = (stored ?? DUMMY_HASH).split(':');
  if (!salt || !key) return false;
  const expected = Buffer.from(key, 'hex');
  const actual = await deriveKey(password, salt);
  return stored !== null && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
