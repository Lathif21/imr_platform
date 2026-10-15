import { PostgrestClient } from '@supabase/postgrest-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env } from '$env/dynamic/private';
import { getSession, SESSION_COOKIE, setSessionCookie } from '$lib/server/auth';
import { parseTheme, THEME_COOKIE } from '$lib/theme';

/**
 * One PostgREST client per request, carrying the caller's JWT. Every query
 * therefore runs as that user and RLS decides what comes back — which is
 * where authorization lives (CLAUDE.md invariant 1).
 *
 * Only `.from()` and `.rpc()` of supabase-js were ever used, and those are
 * PostgREST's own client. Building that directly skips supabase-js's auth and
 * realtime machinery on every request, and talks to a self-hosted PostgREST
 * at its root instead of under `/rest/v1`. The type stays `SupabaseClient`
 * so the call sites need no change; `.auth`, `.storage` and `.channel` do not
 * exist on it and must not be reached for.
 *
 * The session cookie is looked up together with the account and the profile
 * in one query on the local database — the cookie proves nothing by itself —
 * and that lookup is what yields the JWT.
 */
const session: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get(SESSION_COOKIE) ?? null;
  const auth = token ? await getSession(token) : null;

  if (token && !auth) {
    // Expired, revoked or banned: drop it so the next request is clean.
    event.cookies.delete(SESSION_COOKIE, { path: '/' });
  } else if (token && auth?.renewed) {
    setSessionCookie(event.cookies, token, event.url.protocol === 'https:');
  }

  event.locals.session = auth ? token : null;
  event.locals.user = auth?.user ?? null;
  /**
   * Read with the session, for UI shaping — which nav items show, which
   * buttons render. It is NOT a permission check: a user who forges this
   * still cannot read or write anything RLS forbids. Inactive profiles come
   * back as null, matching SQL `current_user_role()`, so a revoked account
   * sees a refusal rather than screens that come back mysteriously empty.
   */
  event.locals.role = auth?.role ?? null;
  event.locals.fullName = auth?.fullName ?? null;

  const headers: Record<string, string> = {};
  if (auth) headers.Authorization = `Bearer ${auth.jwt}`;
  event.locals.supabase = new PostgrestClient(env.DATA_API_URL ?? 'http://127.0.0.1:3000', {
    headers
  }) as unknown as SupabaseClient;

  return resolve(event, {
    filterSerializedResponseHeaders: (name) => name === 'content-range'
  });
};

/** Routes reachable without a session. Everything else redirects to login. */
const PUBLIC_ROUTES = ['/login'];

const authGuard: Handle = async ({ event, resolve }) => {
  const { session } = event.locals;
  const isPublic = PUBLIC_ROUTES.some((route) => event.url.pathname.startsWith(route));

  if (!session && !isPublic) {
    const target = event.url.pathname + event.url.search;
    redirect(303, `/login?redirectTo=${encodeURIComponent(target)}`);
  }

  if (session && event.url.pathname === '/login') {
    redirect(303, '/');
  }

  return resolve(event);
};

/**
 * Stamps the chosen palette onto `<html>` in the response itself. Doing it here
 * rather than from a component is the whole point: `app.css` keys every colour
 * off this attribute, so if it arrived only after hydration the page would
 * paint dark and then snap to light on every full load.
 */
const theme: Handle = async ({ event, resolve }) => {
  const chosen = parseTheme(event.cookies.get(THEME_COOKIE));
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%theme%', chosen)
  });
};

/**
 * Headers that cost nothing and close whole classes of attack. The CSP is
 * deliberately only the directives that cannot break SvelteKit's inline
 * bootstrap: no framing (clickjacking on the approval buttons), no <base>
 * hijack, forms post only here. HSTS is set by Caddy, which owns TLS.
 */
const securityHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set(
    'Content-Security-Policy',
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
  );
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Financial figures: never in a shared cache, never in the back-forward
  // cache of a computer someone else uses next. Hashed assets are served by
  // adapter-node before this hook runs and keep their immutable caching.
  if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'private, no-store');
  return response;
};

export const handle = sequence(securityHeaders, theme, session, authGuard);
