# IMR Platform

One platform for the holding group's financial reporting **and** ILJ's
operational system: the IMR_keu reporting portal, extended with the modules
of the Laravel operational system (LaporanKeuangan) as they are ported.

**Start with [docs/PENGGABUNGAN.md](docs/PENGGABUNGAN.md)** — what was merged,
the decisions behind it, the port order, the data migration plan, and the
questions still open. Everything below describes the reporting portal this
platform was copied from, and still holds for it.

Local Supabase runs on ports **553xx** (`project_id = IMR_platform`), so it can
run beside IMR_keu's stack on 543xx. A fifth seed account,
`admin.ilj@example.test` (`admin_operasional`, ILJ only), exercises the
operational module.

Read these before writing code:

| File | Why |
|---|---|
| [docs/PENGGABUNGAN.md](docs/PENGGABUNGAN.md) | The merge: decisions, port plan, data migration, open questions. |
| [docs/CLAUDE.md](docs/CLAUDE.md) | Non-negotiable invariants. Violating one produces wrong reports. |
| [docs/CONTEXT.md](docs/CONTEXT.md) | Indonesian domain vocabulary. Mixing terms up has already produced wrong numbers once. |
| [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) | Accounting policies that are still undecided. The system surfaces them; it never picks a default. |
| [docs/TESTING.md](docs/TESTING.md) | What is still checked by hand, after `npm test`: session handling and the dashboard. |
| [docs/TESTING-WORKFLOW.md](docs/TESTING-WORKFLOW.md) | The two write screens, walked end to end. |
| [docs/TESTING-PHASE2.md](docs/TESTING-PHASE2.md) | Fase 2 on screen: the P&L report, entity isolation, and the ILJ import. |
| [docs/TESTING-INTEGRASI.md](docs/TESTING-INTEGRASI.md) | The operational system → portal pull, tested end to end on screen with Playwright. |
| [docs/DATABASE.md](docs/DATABASE.md) | Inspecting the schema in DBeaver: tables, relations, triggers, and why RLS looks absent there. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What exists, what does not, and what comes next. |

## Stack

SvelteKit (SSR, adapter-node) + TypeScript · Postgres 18 · PostgREST · RLS ·
Tailwind v4, all on one VPS — see **[deploy/README.md](deploy/README.md)** for
installing, updating, backups, and moving the data over from Neon.

Every query goes through PostgREST with the caller's JWT, so RLS decides what
comes back (`src/hooks.server.ts`). It is called with `@supabase/postgrest-js`
— the query half of `supabase-js` — no ORM, no repository layer. Login,
sessions and account administration live in `src/lib/server/auth.ts`, on the
`auth` schema of the same database (`deploy/sql/platform.sql`).

`deploy/sql/platform.sql` provides what the migrations expect from Supabase —
the `authenticated` role, `auth.uid()` reading the JWT's `sub`, and
`auth.users` — so they apply unchanged:

```sh
cd deploy && docker compose run --rm migrate --bootstrap
```

`--bootstrap` adds the four entities and the operational sync link from
`supabase/neon-bootstrap.sql`; leave it out when the data comes from Neon.

## Running it locally

`npm run dev` talks to Postgres and PostgREST from the compose stack — the
steps are at the top of `deploy/docker-compose.dev.yml`, the variables in
`.env.example`.

The test suite and the seeded accounts below use a local Supabase stack,
which needs Node 20+, Docker Desktop, and the Supabase CLI.

```sh
npm install
cp .env.example .env      # fill in the keys `supabase start` prints
supabase start            # Postgres, Auth, Studio on 127.0.0.1
npm run db:reset          # apply migrations, then supabase/seed.sql
npm test
```

`supabase/seed.sql` creates four local accounts, one per role, all with the
password `devpassword`:

| Email | Role | Sees |
|---|---|---|
| `direksi@example.test` | direksi | everything; can unlock a locked period |
| `manajer@example.test` | manajer_keuangan | everything; approves and locks |
| `staf.ilj@example.test` | staf_entitas | ILJ only |
| `auditor@example.test` | auditor | everything, read-only |

These exist only in a local database. They are not printed anywhere in the UI.

## Security notes

Deliberate limitations, not oversights. Each is a decision that can be revisited
when the group is bigger than ten people.

**Accounts are created by a director, password and all.** The consequences:

- There is **no email verification**. An address is whatever the director typed.
- "Lupa kata sandi" mails a 15-minute link through Brevo — when Brevo is
  configured. The page answers the same whether or not the address exists.
- The director **knows every initial password**. The screen offers a random
  generator and shows the result once, so nobody has to invent one, but the
  password still passes through a human.

Passwords are never written to a log, never stored in `audit_log`, never put in
an error message, and never sent back to the browser after being set. Minimum
length is checked on the server, not only in the form.

**Email cannot be changed** once an account exists. Changing someone's address without verification is how an
account gets taken over. Deactivate and create a new one instead.

**Nobody is ever deleted.** `audit_log.actor_id` points at profiles, and a
history whose actors have vanished is not a history. Deactivating is the way
out, and `current_user_role()` filters `is_active`, so a deactivated account
loses everything immediately — even with a session still in flight.

**There is no service key.** `/admin/users` acts on the director's own
authority: `src/lib/server/auth.ts` re-reads the caller's profile in the same
transaction as every account change and refuses anyone who is not an active
director at that moment. Deactivating an account bans it, which also ends its
sessions; a password reset — by a director or through "Lupa kata sandi" — ends
every session of that account too.

Sessions are a random token in an httpOnly cookie; the database stores only
its sha256. Failed logins are limited to 5 per email and 30 per IP per
15 minutes. There is no public sign-up.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm test` | the regression suite — RLS, workflow triggers, guards, view arithmetic, formatting |
| `npm run test:watch` | the same, in watch mode |
| `npm run check` | `svelte-check` over the whole project |
| `npm run db:reset` | drop, re-migrate and re-seed the local database |
| `npm run db:types` | regenerate `src/lib/server/database.types.ts` from the local schema |

`npm test` runs against the local Supabase stack — start it first. It resets
its own fixture by truncating and replaying `supabase/seed.sql`, which takes
about 100ms, but it does **not** re-apply migrations: run `npm run db:reset`
once after changing the schema.

There is one more script, run by hand rather than by npm:

```sh
npx tsx scripts/import-ilj.ts <path-to-xlsx>
```

It parses ILJ's historical workbook into `supabase/seed-ilj.sql` for review. It
never writes to a database — see [docs/task/03-import-ilj.md](docs/task/03-import-ilj.md).

## Layout

```
supabase/migrations/   Schema. The source of truth. Forward-only.
supabase/seed.sql      Local development data. Never run against production.
src/lib/domain.ts      Enums and view row shapes, hand-written
src/lib/format.ts      The only layer allowed to shorten Rupiah to juta/miliar
src/lib/roles.ts       Mirror of the SQL role predicates — for UI shaping only
src/routes/(app)/      Screens behind a session
scripts/import-ilj.ts  Excel → reviewable SQL. Writes a file, never a database.
tests/                 Seven files, found by name. See docs/task/05-regression-tests.md
docs/                  Invariants, vocabulary, open decisions, roadmap
design/figma-export/   The original Figma Make React export. Reference only.
```

## Status

| Screen | Route | State |
|---|---|---|
| Dasbor Eksekutif | `/` | built |
| Laporan P&L | `/entities` → `/entities/[id]/periods/[period]` | built |
| Input Laporan | `/entry/[period]` | built |
| Persetujuan | `/approval` | built |

All four screens exist and the sidebar has no disabled item. What is missing is
data rather than code: ILJ's nine real months are still an unrun parser, since
the source workbook is not in the repo. See
[docs/ROADMAP.md](docs/ROADMAP.md).

No deployment target is chosen yet, so `@sveltejs/adapter-auto` cannot detect
a platform and `npm run build` says so. Swap in a real adapter when that is
decided.
