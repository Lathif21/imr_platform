-- =====================================================================
--  Fondasi Postgres di VPS — dijalankan `scripts/migrate.ts` SEBELUM
--  supabase/migrations, setiap kali. Aman diulang.
--
--  Migrasi ditulis untuk Supabase dan mengandalkan tiga hal yang di
--  Supabase (dan di Neon) disediakan platform:
--
--    role `authenticated`   tujuan setiap GRANT dan setiap policy
--    `auth.uid()`           membaca `sub` dari JWT yang diteruskan PostgREST
--    `auth.users`           target FK profiles.id
--
--  Di VPS ketiganya dibuat di sini, dengan bentuk yang sama, sehingga
--  migrasi dan RLS berjalan tanpa diubah satu baris pun.
--
--  Role:
--    authenticator  login PostgREST. NOINHERIT: tidak punya hak apa pun
--                   sampai PostgREST berpindah ke role di klaim JWT.
--    authenticated  pengguna yang sudah login (klaim role JWT).
--    anon           tanpa JWT. Tidak diberi apa pun — portal butuh login.
--    imr_auth       login aplikasi untuk skema auth saja: sesi, kata
--                   sandi, token reset. Tidak bisa menyentuh data
--                   keuangan; hanya membaca profiles untuk peran.
--
--  Kata sandi role login dipasang scripts/migrate.ts dari env, bukan
--  ditulis di file ini.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'imr_auth') then
    create role imr_auth login noinherit;
  end if;
end;
$$;

grant anon, authenticated to authenticator;

create extension if not exists pgcrypto;

create schema if not exists auth;
revoke all on schema auth from public;
-- Policy memanggil auth.uid() dengan hak pemanggil.
grant usage on schema auth to authenticated, anon, imr_auth;

-- ---------------------------------------------------------------------
--  Akun
-- ---------------------------------------------------------------------

create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email = lower(email)),
  -- Format Better Auth (scrypt N=16384 r=16 p=1, "salt:key" hex), supaya
  -- akun yang dipindah dari Neon Auth tetap bisa login dengan sandinya.
  password_hash text,
  banned        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Token disimpan sebagai sha256-nya. Bocornya tabel ini tidak memberi
-- siapa pun sesi yang bisa dipakai.
create table if not exists auth.sessions (
  token_hash   bytea primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent   text,
  ip           text
);
create index if not exists sessions_user_idx on auth.sessions (user_id);
create index if not exists sessions_expires_idx on auth.sessions (expires_at);

create table if not exists auth.password_resets (
  token_hash bytea primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index if not exists password_resets_user_idx on auth.password_resets (user_id);

-- Percobaan login gagal, untuk pembatasan laju per email dan per IP.
create table if not exists auth.login_failures (
  id         bigint generated always as identity primary key,
  email      text not null,
  ip         text,
  at         timestamptz not null default now()
);
create index if not exists login_failures_email_idx on auth.login_failures (email, at);
create index if not exists login_failures_ip_idx on auth.login_failures (ip, at);

revoke all on all tables in schema auth from public, anon, authenticated;
grant select, insert, update, delete on auth.users, auth.sessions, auth.password_resets, auth.login_failures
  to imr_auth;

-- ---------------------------------------------------------------------
--  auth.uid() — definisi yang sama dengan Supabase. PostgREST v12
--  memasang klaim JWT di request.jwt.claims.
-- ---------------------------------------------------------------------

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text;
$$;

grant execute on function auth.uid(), auth.role() to authenticated, anon, imr_auth;
