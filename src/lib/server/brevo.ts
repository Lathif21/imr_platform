/**
 * Transactional email through Brevo's HTTP API.
 *
 * Read from `$env/dynamic/private` so a deployment without Brevo configured
 * still builds; sending then fails loudly instead of silently.
 *
 *   BREVO_API_KEY       — Brevo → SMTP & API → API Keys
 *   BREVO_SENDER_EMAIL  — must be a verified sender in Brevo
 *   BREVO_SENDER_NAME   — optional, defaults to "Portal Keuangan"
 */

import { env } from '$env/dynamic/private';

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail({ to, subject, html, text }: Email): Promise<void> {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    throw new Error('BREVO_API_KEY atau BREVO_SENDER_EMAIL belum dipasang');
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME || 'Portal Keuangan' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text
    }),
    signal: AbortSignal.timeout(8_000)
  });

  if (!response.ok) {
    // Brevo's error body names the problem (bad key, unverified sender) and
    // never echoes the key back, so it is safe to log.
    throw new Error(`Brevo ${response.status}: ${await response.text().catch(() => '')}`);
  }
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A single-button email. Inline styles only: mail clients drop <style>. */
export function linkEmail({ heading, body, button, url, footer }: {
  heading: string;
  body: string;
  button: string;
  url: string;
  footer: string;
}): { html: string; text: string } {
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b">
  <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:28px">
    <tr><td>
      <p style="margin:0 0 4px;font-size:14px;font-weight:bold">Portal Keuangan</p>
      <h1 style="margin:16px 0 12px;font-size:18px">${escape(heading)}</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.5">${escape(body)}</p>
      <a href="${escape(url)}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">${escape(button)}</a>
      <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#71717a">${escape(footer)}</p>
      <p style="margin:12px 0 0;font-size:11px;color:#a1a1aa;word-break:break-all">${escape(url)}</p>
    </td></tr>
  </table>
</body></html>`;
  const text = `${heading}\n\n${body}\n\n${url}\n\n${footer}`;
  return { html, text };
}
