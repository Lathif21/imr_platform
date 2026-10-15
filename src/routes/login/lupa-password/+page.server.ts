import { fail } from '@sveltejs/kit';
import { requestPasswordReset } from '$lib/server/auth';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, url }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim().slice(0, 320);

    if (!email) return fail(400, { email, message: 'Email wajib diisi.' });

    try {
      // `url.origin` is the configured ORIGIN in production (adapter-node),
      // not the request's Host header — the link in the mail cannot be
      // pointed at someone else's domain by a forged header.
      await requestPasswordReset(email, url.origin);
    } catch (cause) {
      console.error('[lupa-password]', (cause as Error).message);
      return fail(503, { email, message: 'Permintaan tidak dapat diproses saat ini. Coba lagi.' });
    }

    // Same answer whether or not the address has an account — otherwise
    // this page would tell anyone which emails are registered.
    return { sent: true, email };
  }
};
