import { fail, redirect } from '@sveltejs/kit';
import { AuthError, MIN_PASSWORD, resetPassword } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  return { token: url.searchParams.get('token') ?? '' };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const token = String(form.get('token') ?? '');
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');

    if (!token) return fail(400, { expired: true, message: 'Tautan tidak valid. Minta tautan baru.' });
    // Same floor as /admin/users, so a reset cannot set what an admin couldn't.
    if (password.length < MIN_PASSWORD) {
      return fail(400, { expired: false, message: `Kata sandi minimal ${MIN_PASSWORD} karakter.` });
    }
    if (password !== confirm) return fail(400, { expired: false, message: 'Konfirmasi kata sandi tidak sama.' });

    let ok: boolean;
    try {
      ok = await resetPassword(token, password);
    } catch (cause) {
      if (cause instanceof AuthError && cause.status === 400) {
        return fail(400, { expired: false, message: cause.message });
      }
      console.error('[reset-password]', (cause as Error).message);
      return fail(503, { expired: false, message: 'Layanan sedang bermasalah. Coba lagi.' });
    }

    if (!ok) {
      return fail(400, { expired: true, message: 'Tautan sudah kedaluwarsa atau sudah dipakai. Minta tautan baru.' });
    }

    redirect(303, '/login?reset=1');
  }
};
