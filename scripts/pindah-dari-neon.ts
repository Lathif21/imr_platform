/**
 * Copy production data from Neon to the VPS Postgres — once, at cutover.
 *
 *   docker compose run --rm -e NEON_DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' pindah
 *
 * Neon is only read. The VPS side runs in ONE transaction: it empties every
 * public table and the accounts, copies everything, and either commits all of
 * it or nothing. Run `migrate` first so both schemas match.
 *
 *   accounts  neon_auth."user" + credential password → auth.users. The hash
 *             format is the same (src/lib/server/password.ts), so everyone
 *             logs in with the password they already have.
 *   data      every public table, row for row, with triggers and FK checks
 *             off (session_replication_role = replica): audit_log, workflow
 *             stamps and period statuses arrive exactly as they are in Neon
 *             instead of being rewritten by the triggers that guard them.
 *   identity  sequences moved past the highest copied id.
 *   check     row counts compared table by table before COMMIT.
 *
 * Rows travel as JSON (json_agg → json_populate_recordset), which keeps
 * numeric(18,2) exact and does not care that Neon runs a different Postgres
 * major than the VPS — pg_dump would.
 */

import pg from 'pg';

const SKIP = new Set(['neon_schema_migrations']);

async function main() {
  const sourceUrl = process.env.NEON_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('NEON_DATABASE_URL belum diisi (koneksi langsung, bukan -pooler)');
  if (!targetUrl) throw new Error('DATABASE_URL belum diisi');

  const source = new pg.Client({ connectionString: sourceUrl });
  const target = new pg.Client({ connectionString: targetUrl });
  await source.connect();
  await target.connect();

  try {
    // A consistent snapshot of Neon for the whole copy.
    await source.query('begin isolation level repeatable read read only');

    const { rows: tableRows } = await target.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = 'public' order by tablename"
    );
    const tables = tableRows.map((row) => row.name).filter((name) => !SKIP.has(name));

    const { rows: sourceTables } = await source.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = 'public'"
    );
    const inSource = new Set(sourceTables.map((row) => row.name));
    const missing = tables.filter((name) => !inSource.has(name));
    if (missing.length) {
      throw new Error(`Tabel ini ada di VPS tapi tidak di Neon — migrasikan Neon dulu: ${missing.join(', ')}`);
    }
    const extra = [...inSource].filter((name) => !SKIP.has(name) && !tables.includes(name));
    if (extra.length) throw new Error(`Tabel ini ada di Neon tapi tidak di VPS: ${extra.join(', ')}`);

    await target.query('begin');
    await target.query("set local session_replication_role = 'replica'");

    await target.query(
      `truncate ${tables.map((name) => `public.${pg.escapeIdentifier(name)}`).join(', ')} restart identity cascade`
    );
    await target.query('truncate auth.sessions, auth.password_resets, auth.login_failures');
    await target.query('delete from auth.users');

    // ---- accounts --------------------------------------------------------
    const { rows: users } = await source.query<{ data: string; n: number; tanpa_sandi: number }>(
      `select coalesce(json_agg(t), '[]'::json)::text as data, count(*)::int as n,
              count(*) filter (where t.password_hash is null)::int as tanpa_sandi
         from (
           select u.id, lower(u.email) as email, a.password as password_hash,
                  coalesce(u.banned, false) as banned, u."createdAt" as created_at
             from neon_auth."user" u
             left join neon_auth.account a on a."userId" = u.id and a."providerId" = 'credential'
         ) t`
    );
    await target.query(
      `insert into auth.users (id, email, password_hash, banned, created_at)
       select id, email, password_hash, banned, created_at
         from json_populate_recordset(null::auth.users, $1::json)`,
      [users[0].data]
    );
    const { n, tanpa_sandi } = users[0];
    console.log(`akun   ${n}${tanpa_sandi ? ` (${tanpa_sandi} tanpa kata sandi — reset lewat admin)` : ''}`);

    // ---- data -------------------------------------------------------------
    for (const name of tables) {
      const table = `public.${pg.escapeIdentifier(name)}`;
      // Generated columns cannot be written; identity ALWAYS needs OVERRIDING.
      const { rows: columns } = await target.query<{ name: string; always: boolean }>(
        `select a.attname as name, a.attidentity = 'a' as always
           from pg_attribute a
          where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
          order by a.attnum`,
        [table]
      );
      const list = columns.map((column) => pg.escapeIdentifier(column.name)).join(', ');
      const overriding = columns.some((column) => column.always) ? 'overriding system value' : '';

      // `::text`, never parsed here: JSON.parse would turn a numeric(18,2)
      // above 2^53 or a large bigint into a rounded JavaScript number.
      const { rows } = await source.query<{ data: string; n: number }>(
        `select coalesce(json_agg(t), '[]'::json)::text as data, count(*)::int as n
           from (select ${list} from ${table}) t`
      );
      await target.query(
        `insert into ${table} (${list}) ${overriding}
         select ${list} from json_populate_recordset(null::${table}, $1::json)`,
        [rows[0].data]
      );
      console.log(`salin  ${name.padEnd(32)} ${rows[0].n}`);
    }

    // ---- identity / serial -----------------------------------------------
    const { rows: sequences } = await target.query<{ seq: string; tbl: string; col: string }>(
      `select pg_get_serial_sequence(format('public.%I', c.relname), a.attname) as seq,
              format('public.%I', c.relname) as tbl, a.attname as col
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
         join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where c.relkind = 'r' and pg_get_serial_sequence(format('public.%I', c.relname), a.attname) is not null`
    );
    for (const { seq, tbl, col } of sequences) {
      await target.query(
        `select setval($1, coalesce((select max(${pg.escapeIdentifier(col)}) from ${tbl}), 0) + 1, false)`,
        [seq]
      );
    }

    // ---- check ------------------------------------------------------------
    const beda: string[] = [];
    for (const name of tables) {
      const table = `public.${pg.escapeIdentifier(name)}`;
      const [{ rows: a }, { rows: b }] = await Promise.all([
        source.query<{ n: string }>(`select count(*) as n from ${table}`),
        target.query<{ n: string }>(`select count(*) as n from ${table}`)
      ]);
      if (a[0].n !== b[0].n) beda.push(`${name}: Neon ${a[0].n}, VPS ${b[0].n}`);
    }
    if (beda.length) throw new Error(`Jumlah baris berbeda, tidak ada yang disimpan:\n  ${beda.join('\n  ')}`);

    await target.query('commit');
    console.log(`ok     ${tables.length} tabel cocok jumlahnya dengan Neon`);
  } catch (error) {
    await target.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await source.query('rollback').catch(() => undefined);
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
