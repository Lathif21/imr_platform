/**
 * Apply the schema to the VPS Postgres.
 *
 *   DATABASE_URL=postgres://postgres:...@db:5432/imr \
 *   AUTHENTICATOR_PASSWORD=... IMR_AUTH_PASSWORD=... \
 *   npx tsx scripts/migrate.ts [--bootstrap]
 *
 * Inside the compose stack: `docker compose run --rm migrate` (see deploy/).
 *
 * Order, every run:
 *   1. deploy/sql/platform.sql         roles, `auth` schema, auth.uid() — idempotent
 *   2. supabase/migrations/*.sql       each new file in its own transaction
 *   3. deploy/sql/after-migrations.sql grants for imr_auth, PostgREST schema reload
 *
 * The migrations stay written for Supabase, because `npm test` still runs on
 * the local Supabase stack; step 1 provides exactly what they expect from the
 * platform, so they apply unchanged. Applied files are recorded in
 * `imr_meta.migrations`, so a second run only applies what is new.
 * `--bootstrap` additionally applies `supabase/neon-bootstrap.sql` (entities
 * and the operational sync link), which is idempotent.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = 'supabase/migrations';
const PLATFORM_FILE = 'deploy/sql/platform.sql';
const AFTER_FILE = 'deploy/sql/after-migrations.sql';
const BOOTSTRAP_FILE = 'supabase/neon-bootstrap.sql';

async function setPassword(client: pg.Client, role: string, password: string | undefined) {
  if (!password) {
    console.warn(`warn   ${role}: kata sandi tidak diberikan, tidak diubah`);
    return;
  }
  if (password.length < 16) throw new Error(`${role}: kata sandi minimal 16 karakter`);
  const { rows } = await client.query<{ sql: string }>('select format($1, $2::text, $3::text) as sql', [
    'alter role %I with login password %L',
    role,
    password
  ]);
  await client.query(rows[0].sql);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL belum diisi');

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    await client.query(readFileSync(PLATFORM_FILE, 'utf8'));
    console.log(`apply  ${PLATFORM_FILE}`);

    await setPassword(client, 'authenticator', process.env.AUTHENTICATOR_PASSWORD);
    await setPassword(client, 'imr_auth', process.env.IMR_AUTH_PASSWORD);

    await client.query(`
      create schema if not exists imr_meta;
      revoke all on schema imr_meta from public;
      create table if not exists imr_meta.migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`);
    const { rows } = await client.query<{ name: string }>('select name from imr_meta.migrations');
    const applied = new Set(rows.map((row) => row.name));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into imr_meta.migrations (name) values ($1)', [name]);
        await client.query('commit');
        console.log(`apply  ${name}`);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`${name}: ${(error as Error).message}`);
      }
    }
    console.log(`ok     ${files.length} migrasi, ${files.length - applied.size} baru`);

    if (process.argv.includes('--bootstrap')) {
      await client.query(readFileSync(BOOTSTRAP_FILE, 'utf8'));
      console.log(`apply  ${BOOTSTRAP_FILE}`);
    }

    await client.query(readFileSync(AFTER_FILE, 'utf8'));
    console.log(`apply  ${AFTER_FILE}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
