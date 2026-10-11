import crypto from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { NEON_AUTH_BASE_URL } from '$env/static/private';
import { linkEmail, sendEmail } from '$lib/server/brevo';
import type { RequestHandler } from './$types';

/**
 * Neon Auth webhook, subscribed to `send.magic_link` only.
 *
 * Subscribing makes Neon skip its own email for that event, so this handler
 * is now the only way a reset link reaches anyone: it must answer 2xx only
 * after Brevo accepted the mail. A non-2xx makes Neon retry, and after three
 * failures the user sees an error instead of a link that never arrives.
 *
 * Public by necessity (`/auth` is in PUBLIC_ROUTES); the Ed25519 signature
 * is what proves the call came from Neon. The payload carries a live reset
 * token, so nothing here logs the body.
 */

type Jwk = crypto.JsonWebKeyInput["key"] & { kid: string };
let jwks: Jwk[] = [];

async function keyFor(kid: string): Promise<crypto.KeyObject> {
  let jwk = jwks.find((k) => k.kid === kid);
  if (!jwk) {
    // Unknown kid: Neon may have rotated keys. Refresh once, then give up.
    const response = await fetch(`${NEON_AUTH_BASE_URL}/.well-known/jwks.json`, {
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error(`JWKS ${response.status}`);
    jwks = ((await response.json()) as { keys: Jwk[] }).keys ?? [];
    jwk = jwks.find((k) => k.kid === kid);
  }
  if (!jwk) throw new Error('kid tidak dikenal');
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

async function verified(raw: string, headers: Headers): Promise<boolean> {
  const signature = headers.get('x-neon-signature');
  const kid = headers.get('x-neon-signature-kid');
  const timestamp = headers.get('x-neon-timestamp');
  if (!signature || !kid || !timestamp) return false;

  // Older than five minutes is a replay, not a retry.
  if (!(Math.abs(Date.now() - Number(timestamp)) < 5 * 60 * 1000)) return false;

  const [header, detached, sig] = signature.split('.');
  if (detached !== '' || !header || !sig) return false;

  const payload = Buffer.from(`${timestamp}.${Buffer.from(raw, 'utf8').toString('base64url')}`).toString(
    'base64url'
  );
  return crypto.verify(null, Buffer.from(`${header}.${payload}`), await keyFor(kid), Buffer.from(sig, 'base64url'));
}

interface MagicLinkEvent {
  event_type: string;
  user?: { email?: string };
  event_data?: { link_type?: string; link_url?: string; token?: string };
}

export const POST: RequestHandler = async ({ request, url }) => {
  const raw = await request.text();

  let ok = false;
  try {
    ok = await verified(raw, request.headers);
  } catch (cause) {
    console.error('[auth/webhook] verifikasi:', (cause as Error).message);
  }
  // 401 is not retried by Neon, which is right: a bad signature stays bad.
  if (!ok) error(401, 'invalid signature');

  const event = JSON.parse(raw) as MagicLinkEvent;
  if (event.event_type !== 'send.magic_link') return json({ ignored: true });

  const to = event.user?.email;
  const data = event.event_data;
  if (!to || !data?.token) error(400, 'payload tidak lengkap');

  let mail: { subject: string; html: string; text: string };
  if (data.link_type === 'forget-password') {
    // Our own page, not Neon's link_url: the user never leaves this domain,
    // and the token goes straight to `reset-password`.
    const link = `${url.origin}/login/reset-password?token=${encodeURIComponent(data.token)}`;
    mail = {
      subject: 'Atur ulang kata sandi Portal Keuangan',
      ...linkEmail({
        heading: 'Atur ulang kata sandi',
        body: 'Kami menerima permintaan untuk mengatur ulang kata sandi akun Anda. Klik tombol di bawah untuk membuat kata sandi baru. Tautan ini berlaku 15 menit.',
        button: 'Buat kata sandi baru',
        url: link,
        footer: 'Bila Anda tidak meminta ini, abaikan email ini. Kata sandi Anda tidak berubah.'
      })
    };
  } else if (data.link_url) {
    // The portal uses no other magic links today, but subscribing switched
    // Neon's own delivery off for all of them — forward rather than drop.
    mail = {
      subject: 'Tautan dari Portal Keuangan',
      ...linkEmail({
        heading: 'Tautan akun Anda',
        body: 'Klik tombol di bawah untuk melanjutkan.',
        button: 'Lanjutkan',
        url: data.link_url,
        footer: 'Bila Anda tidak meminta ini, abaikan email ini.'
      })
    };
  } else {
    error(400, 'payload tidak lengkap');
  }

  try {
    await sendEmail({ to, ...mail });
  } catch (cause) {
    console.error('[auth/webhook] Brevo:', (cause as Error).message);
    // 5xx so Neon retries.
    error(502, 'email gagal dikirim');
  }

  return json({ sent: true });
};
