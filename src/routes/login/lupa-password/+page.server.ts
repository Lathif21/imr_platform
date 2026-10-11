import { fail } from '@sveltejs/kit';
import { requestPasswordReset } from '$lib/server/neon-auth';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, url }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim();

    if (!email) return fail(400, { email, message: 'Email wajib diisi.' });

    try {
      await requestPasswordReset(url.origin, email, `${url.origin}/login/reset-password`);
    } catch (cause) {
      console.error('[lupa-password] Neon Auth:', (cause as Error).message);
      return fail(502, { email, message: 'Permintaan tidak dapat diproses saat ini. Coba lagi.' });
    }

    // Same answer whether or not the address has an account — otherwise
    // this page would tell anyone which emails are registered.
    return { sent: true, email };
  }
};
