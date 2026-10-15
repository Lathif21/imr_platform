/**
 * Authentication for the VPS deployment. Replaces Neon Auth.
 *
 * Accounts, sessions and reset tokens live in the `auth` schema of the same
 * Postgres (deploy/sql/platform.sql). This module reaches it through its own
 * pool, logged in as `imr_auth` — a role that can touch nothing but that
 * schema and four columns of `profiles`. Every query on financial data still
 * goes through PostgREST under the caller's JWT, so RLS keeps deciding
 * (CLAUDE.md invariant 1); this file only decides who the caller is.
 *
 *   cookie   random 32 bytes, httpOnly. The database stores its sha256, so a
 *            leaked `auth.sessions` yields no usable session.
 *   JWT      signed here per request (HS256, five minutes) for PostgREST;
 *            `sub` is what `auth.uid()` returns inside every policy.
 *   password scrypt in Better Auth's format, so accounts moved from Neon
 *            Auth keep working with the password they already have.
 *
 * Nothing here ever logs a password, a token or a cookie value.
 */

import crypto from 'node:crypto';
import pg from 'pg';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { UserRole } from '$lib/domain';
import { linkEmail, sendEmail } from '$lib/server/brevo';
import { hashPassword, verifyPassword } from '$lib/server/password';

export const SESSION_COOKIE = 'imr_session';

const SESSION_DAYS = 7;
/** Sliding expiry stops here, however active the session. */
const SESSION_MAX_DAYS = 30;
const JWT_SECONDS = 300;
const RESET_MINUTES = 15;

/** Failed logins tolerated per email, and per IP, in the window below. */
const MAX_FAILURES_EMAIL = 5;
const MAX_FAILURES_IP = 30;
const FAILURE_WINDOW_MINUTES = 15;

export const MIN_PASSWORD = 8;

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  user: AuthUser;
  /** From `profiles`, active profiles only. UI shaping, never a permission. */
  role: UserRole | null;
  fullName: string | null;
  /** Short-lived JWT for PostgREST. */
  jwt: string;
  /** The expiry slid forward; the cookie should be re-issued. */
  renewed: boolean;
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

let pool: pg.Pool | null = null;

function db(): pg.Pool {
  if (!pool) {
    if (!env.AUTH_DATABASE_URL) throw new AuthError(500, 'NOT_CONFIGURED', 'AUTH_DATABASE_URL belum diisi');
    pool = new pg.Pool({ connectionString: env.AUTH_DATABASE_URL, max: 5, idleTimeoutMillis: 30_000 });
    pool.on('error', (cause) => console.error('[auth] pool:', cause.message));
  }
  return pool;
}

async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw cause;
  } finally {
    client.release();
  }
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest();
const normalizeEmail = (email: string) => email.trim().toLowerCase();

function jwtSecret(): string {
  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new AuthError(500, 'NOT_CONFIGURED', 'JWT_SECRET belum diisi atau kurang dari 32 karakter');
  }
  return secret;
}

/**
 * The only JWT this application issues. `role` is always `authenticated`:
 * PostgREST switches to whatever role the claim names, so nothing from a
 * request may ever reach it.
 */
function signJwt(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + JWT_SECONDS })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', jwtSecret()).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD) {
    throw new AuthError(400, 'PASSWORD_TOO_SHORT', `Password minimal ${MIN_PASSWORD} karakter.`);
  }
  // scrypt over a megabyte of input is a cheap way to burn our CPU.
  if (password.length > 256) throw new AuthError(400, 'PASSWORD_TOO_LONG', 'Password terlalu panjang.');
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SignInResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'invalid' | 'throttled' };

/**
 * Wrong email, wrong password and a banned account all answer `invalid`:
 * the difference would tell an attacker which addresses exist.
 */
export async function signIn(
  emailInput: string,
  password: string,
  meta: { ip: string | null; userAgent: string | null }
): Promise<SignInResult> {
  const email = normalizeEmail(emailInput);
  const pool = db();

  const { rows: failures } = await pool.query<{ by_email: number; by_ip: number }>(
    `select count(*) filter (where email = $1)::int as by_email,
            count(*) filter (where ip = $2)::int    as by_ip
       from auth.login_failures
      where at > now() - make_interval(mins => $3) and (email = $1 or ip = $2)`,
    [email, meta.ip, FAILURE_WINDOW_MINUTES]
  );
  if (failures[0].by_email >= MAX_FAILURES_EMAIL || failures[0].by_ip >= MAX_FAILURES_IP) {
    return { ok: false, reason: 'throttled' };
  }

  const { rows } = await pool.query<{ id: string; password_hash: string | null; banned: boolean }>(
    'select id, password_hash, banned from auth.users where email = $1',
    [email]
  );
  const user = rows[0];
  const valid = await verifyPassword(password.slice(0, 256), user?.password_hash ?? null);

  if (!user || !valid || user.banned) {
    await pool.query('insert into auth.login_failures (email, ip) values ($1, $2)', [email, meta.ip]);
    return { ok: false, reason: 'invalid' };
  }

  const token = newToken();
  await pool.query(
    `insert into auth.sessions (token_hash, user_id, expires_at, user_agent, ip)
     values ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [hashToken(token), user.id, SESSION_DAYS, meta.userAgent?.slice(0, 300) ?? null, meta.ip]
  );

  // Housekeeping rides on logins; there are few enough of them.
  void Promise.all([
    pool.query("delete from auth.login_failures where email = $1 or at < now() - interval '1 day'", [email]),
    pool.query('delete from auth.sessions where expires_at < now()'),
    pool.query("delete from auth.password_resets where expires_at < now() - interval '1 day'")
  ]).catch((cause) => console.error('[auth] housekeeping:', cause.message));

  return { ok: true, token };
}

/**
 * The cookie proves nothing by itself: it is looked up, with the account and
 * profile, in one query. An active session slides forward at most once an
 * hour, and never past SESSION_MAX_DAYS from login.
 */
export async function getSession(token: string): Promise<AuthSession | null> {
  if (token.length > 100) return null;

  const { rows } = await db().query<{
    id: string;
    email: string;
    role: UserRole | null;
    full_name: string | null;
    stale: boolean;
  }>(
    `select u.id, u.email, p.role, p.full_name,
            s.last_seen_at < now() - interval '1 hour' as stale
       from auth.sessions s
       join auth.users u on u.id = s.user_id and not u.banned
       left join public.profiles p on p.id = u.id and p.is_active
      where s.token_hash = $1
        and s.expires_at > now()
        and s.created_at > now() - make_interval(days => $2)`,
    [hashToken(token), SESSION_MAX_DAYS]
  );
  const row = rows[0];
  if (!row) return null;

  if (row.stale) {
    await db().query(
      `update auth.sessions
          set last_seen_at = now(),
              expires_at = least(now() + make_interval(days => $2), created_at + make_interval(days => $3))
        where token_hash = $1`,
      [hashToken(token), SESSION_DAYS, SESSION_MAX_DAYS]
    );
  }

  return {
    user: { id: row.id, email: row.email },
    role: row.role,
    fullName: row.full_name,
    jwt: signJwt(row.id),
    renewed: row.stale
  };
}

/** The cookie lives exactly as long as the session row it points at. */
export function setSessionCookie(cookies: Cookies, token: string, secure: boolean): void {
  cookies.set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60
  });
}

export async function signOut(token: string): Promise<void> {
  await db()
    .query('delete from auth.sessions where token_hash = $1', [hashToken(token)])
    .catch((cause) => console.error('[auth] signOut:', cause.message));
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/**
 * Always resolves the same way, whether or not the address has an account,
 * and sends the mail in the background so the response time does not tell
 * either. At most one link per account per minute.
 *
 * `origin` must be the configured ORIGIN (adapter-node), never a Host header
 * — it is the domain the link in the mail points to.
 */
export async function requestPasswordReset(emailInput: string, origin: string): Promise<void> {
  const email = normalizeEmail(emailInput);
  const token = newToken();

  const { rows } = await db().query<{ email: string }>(
    `insert into auth.password_resets (token_hash, user_id, expires_at)
     select $1, u.id, now() + make_interval(mins => $3)
       from auth.users u
      where u.email = $2 and not u.banned
        and not exists (
          select 1 from auth.password_resets r
           where r.user_id = u.id and r.created_at > now() - interval '1 minute'
        )
     returning $2::text as email`,
    [hashToken(token), email, RESET_MINUTES]
  );
  if (rows.length === 0) return;

  const link = `${origin}/login/reset-password?token=${encodeURIComponent(token)}`;
  void sendEmail({
    to: email,
    subject: 'Atur ulang kata sandi Portal Keuangan',
    ...linkEmail({
      heading: 'Atur ulang kata sandi',
      body: `Kami menerima permintaan untuk mengatur ulang kata sandi akun Anda. Klik tombol di bawah untuk membuat kata sandi baru. Tautan ini berlaku ${RESET_MINUTES} menit.`,
      button: 'Buat kata sandi baru',
      url: link,
      footer: 'Bila Anda tidak meminta ini, abaikan email ini. Kata sandi Anda tidak berubah.'
    })
  }).catch((cause) => console.error('[auth] email reset:', (cause as Error).message));
}

/**
 * Returns false for an invalid, used or expired token. A successful reset
 * spends every outstanding link of the account and ends all its sessions.
 */
export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  checkPassword(newPassword);
  const hash = await hashPassword(newPassword);

  return transaction(async (client) => {
    const { rows } = await client.query<{ user_id: string }>(
      `select user_id from auth.password_resets
        where token_hash = $1 and used_at is null and expires_at > now()
        for update`,
      [hashToken(token)]
    );
    const userId = rows[0]?.user_id;
    if (!userId) return false;

    await client.query('update auth.users set password_hash = $2, updated_at = now() where id = $1', [userId, hash]);
    await client.query('update auth.password_resets set used_at = now() where user_id = $1 and used_at is null', [
      userId
    ]);
    await client.query('delete from auth.sessions where user_id = $1', [userId]);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Account administration — directors only
// ---------------------------------------------------------------------------

/**
 * Checked against `profiles` on every call, in the same transaction as the
 * change, not against the role cached on the request: a director demoted a
 * second ago cannot reset anyone's password with a page they still have open.
 */
async function asDirector<T>(callerId: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    const { rowCount } = await client.query(
      "select 1 from public.profiles where id = $1 and role = 'direksi' and is_active",
      [callerId]
    );
    if (!rowCount) throw new AuthError(403, 'FORBIDDEN', 'Hanya direksi aktif yang dapat mengelola akun.');
    return work(client);
  });
}

export const admin = {
  async listUsers(callerId: string): Promise<AuthUser[]> {
    return asDirector(callerId, async (client) => {
      const { rows } = await client.query<AuthUser>('select id, email from auth.users');
      return rows;
    });
  },

  async createUser(callerId: string, input: { email: string; password: string }): Promise<string> {
    checkPassword(input.password);
    const hash = await hashPassword(input.password);
    return asDirector(callerId, async (client) => {
      try {
        const { rows } = await client.query<{ id: string }>(
          'insert into auth.users (email, password_hash) values ($1, $2) returning id',
          [normalizeEmail(input.email), hash]
        );
        return rows[0].id;
      } catch (cause) {
        if ((cause as { code?: string }).code === '23505') {
          throw new AuthError(400, 'USER_ALREADY_EXISTS', 'Email itu sudah terdaftar.');
        }
        throw cause;
      }
    });
  },

  async removeUser(callerId: string, userId: string): Promise<void> {
    await asDirector(callerId, (client) => client.query('delete from auth.users where id = $1', [userId]));
  },

  /** Also ends the account's sessions: whoever held the old password is out. */
  async setPassword(callerId: string, userId: string, newPassword: string): Promise<void> {
    checkPassword(newPassword);
    const hash = await hashPassword(newPassword);
    await asDirector(callerId, async (client) => {
      const { rowCount } = await client.query(
        'update auth.users set password_hash = $2, updated_at = now() where id = $1',
        [userId, hash]
      );
      if (!rowCount) throw new AuthError(404, 'NOT_FOUND', 'Akun tidak ditemukan.');
      await client.query('delete from auth.sessions where user_id = $1', [userId]);
    });
  },

  /** Banning also ends every session the account holds. */
  async ban(callerId: string, userId: string): Promise<void> {
    await asDirector(callerId, async (client) => {
      await client.query('update auth.users set banned = true, updated_at = now() where id = $1', [userId]);
      await client.query('delete from auth.sessions where user_id = $1', [userId]);
    });
  },

  async unban(callerId: string, userId: string): Promise<void> {
    await asDirector(callerId, (client) =>
      client.query('update auth.users set banned = false, updated_at = now() where id = $1', [userId])
    );
  }
};
