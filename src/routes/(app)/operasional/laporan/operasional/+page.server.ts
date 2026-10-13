import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import type { DetailRow } from '$lib/server/detail-kegiatan';
import { muatLaporanOperasional, type RingkasKapal } from '$lib/server/laporan-operasional';

/** Laporan Operasional. The figures come from muatLaporanOperasional(), shared with the Excel export. */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  if (!opEntity) return { periode, ringkas: [] as RingkasKapal[], kegiatan: [] as DetailRow[] };
  return { periode, ...(await muatLaporanOperasional(locals.supabase, opEntity.id, periode)) };
};
