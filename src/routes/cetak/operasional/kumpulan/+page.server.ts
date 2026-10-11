import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { entitasCetak } from '$lib/server/cetak';
import { muatKumpulan } from '$lib/server/kumpulan';

/** cetakKumpulanPendapatan — the saved version when there is one, else computed. */
export const load: PageServerLoad = async ({ locals, url }) => {
  const entity = await entitasCetak(locals, url);
  const periode = periodeDari(url);
  return { entity, periode, kumpulan: await muatKumpulan(locals.supabase, entity.id, periode) };
};
