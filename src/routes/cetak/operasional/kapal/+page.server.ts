import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { entitasCetak } from '$lib/server/cetak';
import { muatLaporanKapal } from '$lib/server/laporan-kapal';

/** Laporan per Kapal on paper: `?kapal=<id>` for one ship, without it every ship of the month. */
export const load: PageServerLoad = async ({ locals, url }) => {
  const entity = await entitasCetak(locals, url);
  const periode = periodeDari(url);
  const kapalFilter = Number(url.searchParams.get('kapal')) || null;
  const { laporan } = await muatLaporanKapal(locals.supabase, entity.id, periode);
  return { entity, periode, laporan: kapalFilter ? laporan.filter((l) => l.kapal_id === kapalFilter) : laporan };
};
