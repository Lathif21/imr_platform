import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { entitasCetak } from '$lib/server/cetak';
import { muatRekapPendapatan } from '$lib/server/laporan-operasional';

/** REKAP INCOME — LaporanController::cetakPendapatan. Data: muatRekapPendapatan(). */
export const load: PageServerLoad = async ({ locals, url }) => {
  const entity = await entitasCetak(locals, url);
  const periode = periodeDari(url);
  return { entity, periode, ...(await muatRekapPendapatan(locals.supabase, entity.id, periode)) };
};
