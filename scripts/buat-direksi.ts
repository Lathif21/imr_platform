/**
 * Create the first director on a fresh database — the only account that does
 * not come from /admin/users, because /admin/users needs a director.
 *
 *   docker compose run --rm akun --email direksi@pt.co.id --nama "Nama Lengkap"
 *
 * Prints a random password once. The director changes it through
 * "Lupa kata sandi", or another director resets it later.
 *
 * Refuses when an active director already exists: past the first one,
 * accounts are made in the portal, where the audit trail names who made them.
 */

import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { hashPassword } from '../src/lib/server/password';

async function main() {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, nama: { type: 'string' } }
  });
  const email = values.email?.trim().toLowerCase();
  const nama = values.nama?.trim();
  if (!email?.includes('@') || !nama) throw new Error('Pakai: --email <alamat> --nama "<nama lengkap>"');

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL belum diisi');

  const password = crypto.randomBytes(12).toString('base64url');
  const hash = await hashPassword(password);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('begin');
    const { rowCount } = await client.query(
      "select 1 from profiles where role = 'direksi' and is_active for update"
    );
    if (rowCount) throw new Error('Sudah ada direksi aktif. Buat akun berikutnya di /admin/users.');

    const { rows } = await client.query<{ id: string }>(
      'insert into auth.users (email, password_hash) values ($1, $2) returning id',
      [email, hash]
    );
    await client.query("insert into profiles (id, full_name, role) values ($1, $2, 'direksi')", [rows[0].id, nama]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }

  console.log(`Direksi dibuat: ${email}`);
  console.log(`Kata sandi sementara (sekali tampil): ${password}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
