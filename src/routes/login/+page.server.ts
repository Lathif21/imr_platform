import { fail, redirect } from '@sveltejs/kit';
import { setSessionCookie, signIn } from '$lib/server/auth';
import type { Actions } from './$types';

/**
 * Resolve `?redirectTo=` to a path on this origin, or to `/`.
 *
 * A `startsWith('/') && !startsWith('//')` test is not enough. Browsers strip
 * tab, LF and CR from a URL before resolving it, so `/\t/evil.example.com`
 * passes that test and then becomes `//evil.example.com` — a protocol-relative
 * URL pointing off-site. Backslashes get the same treatment for http(s).
 *
 * So: drop the characters browsers drop, then resolve against our own origin
 * and require that the result actually stayed there. The origin check is the
 * real defence; the prefix test just rejects the obvious cases early.
 */
function safeRedirect(requested: string | null, origin: string): string {
  if (!requested) return '/';

  const cleaned = requested.replace(/[\t\n\r]/g, '');
  if (!cleaned.startsWith('/') || cleaned.startsWith('//')) return '/';

  try {
    const resolved = new URL(cleaned, origin);
    return resolved.origin === origin ? resolved.pathname + resolved.search : '/';
  } catch {
    return '/';
  }
}

/** For rate limiting. Throws behind a proxy whose ADDRESS_HEADER is not set. */
function clientAddress(get: () => string): string | null {
  try {
    return get();
  } catch {
    return null;
  }
}

/**
 * Credentials are never in source and never displayed. The prototype printed
 * working logins on its login screen (see CLAUDE.md anti-patterns).
 */
export const actions: Actions = {
  default: async ({ request, url, cookies, getClientAddress }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');

    if (!email || !password) {
      return fail(400, { email, message: 'Email dan kata sandi wajib diisi.' });
    }

    let result: Awaited<ReturnType<typeof signIn>>;
    try {
      result = await signIn(email, password, {
        ip: clientAddress(getClientAddress),
        userAgent: request.headers.get('user-agent')
      });
    } catch (cause) {
      console.error('[login]', (cause as Error).message);
      return fail(503, { email, message: 'Layanan login sedang bermasalah. Coba lagi sebentar.' });
    }

    if (!result.ok && result.reason === 'throttled') {
      // The same answer for every address, so it reveals nothing about which exist.
      return fail(429, {
        email,
        message: 'Terlalu banyak percobaan masuk yang gagal. Tunggu 15 menit, lalu coba lagi.'
      });
    }

    if (!result.ok) {
      // Deliberately not distinguishing "unknown email" from "wrong password"
      // (or a banned account): that difference tells an attacker which
      // addresses exist.
      return fail(400, { email, message: 'Email atau kata sandi tidak sesuai.' });
    }

    setSessionCookie(cookies, result.token, url.protocol === 'https:');

    redirect(303, safeRedirect(url.searchParams.get('redirectTo'), url.origin));
  }
};
