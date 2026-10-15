/**
 * Accounts moved from Neon Auth keep their password hashes as they are
 * (scripts/pindah-dari-neon.ts). If this format ever drifts, every one of
 * them is locked out at once — so it is pinned to a hash Better Auth 1.7.9
 * itself produced.
 */

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '$lib/server/password';

const BETTER_AUTH_HASH =
  '796472bf380011be2198b4b0cc2c023a:2fe0725265501bc2c3bc8a9bd8d64a386e4b70f29662ef498e85c9454cafc8ef03cbafc00da0a3f06167cd3953d73a685728bfbeea6c4e58593391784f0b6766';

describe('kata sandi', () => {
  it('menerima hash buatan Better Auth (akun dari Neon Auth)', async () => {
    expect(await verifyPassword('sandi-dari-neon-auth', BETTER_AUTH_HASH)).toBe(true);
    expect(await verifyPassword('sandi-lain', BETTER_AUTH_HASH)).toBe(false);
  });

  it('hash baru memakai format yang sama dan bisa diverifikasi', async () => {
    const hash = await hashPassword('rahasia ü 123');
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(await verifyPassword('rahasia ü 123', hash)).toBe(true);
    expect(await verifyPassword('rahasia u 123', hash)).toBe(false);
  });

  it('akun tanpa hash tidak pernah cocok', async () => {
    expect(await verifyPassword('', null)).toBe(false);
    expect(await verifyPassword('apa saja', null)).toBe(false);
  });
});
