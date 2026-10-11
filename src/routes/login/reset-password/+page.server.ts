import { fail, redirect } from '@sveltejs/kit';
import { resetPassword } from '$lib/server/neon-auth';
import type { Actions, PageServerLoad } from './$types';

/** Same floor as /admin/users, so a reset cannot set what an admin couldn't. */
const MIN_PASSWORD = 8;

export const load: PageServerLoad = async ({ url }) => {
  return { token: url.searchParams.get('token') ?? '' };
};

export const actions: Actions = {
  default: async ({ request, url }) => {
    const form = await request.formData();
    const token = String(form.get('token') ?? '');
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');

    if (!token) return fail(400, { expired: true, message: 'Tautan tidak valid. Minta tautan baru.' });
    if (password.length < MIN_PASSWORD) {
      return fail(400, { expired: false, message: `Kata sandi minimal ${MIN_PASSWORD} karakter.` });
    }
    if (password !== confirm) return fail(400, { expired: false, message: 'Konfirmasi kata sandi tidak sama.' });

    let ok: boolean;
    try {
      ok = await resetPassword(url.origin, token, password);
    } catch (cause) {
      console.error('[reset-password] Neon Auth:', (cause as Error).message);
      return fail(502, { expired: false, message: 'Layanan sedang tidak dapat dihubungi. Coba lagi.' });
    }

    if (!ok) {
      return fail(400, { expired: true, message: 'Tautan sudah kedaluwarsa atau sudah dipakai. Minta tautan baru.' });
    }

    redirect(303, '/login?reset=1');
  }
};
