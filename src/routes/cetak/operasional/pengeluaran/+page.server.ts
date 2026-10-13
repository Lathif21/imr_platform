import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { entitasCetak } from '$lib/server/cetak';
import { muatRekapPengeluaran } from '$lib/server/laporan-operasional';

/** Rekapan Pengeluaran — PengeluaranController::cetak. Data: muatRekapPengeluaran(). */
export const load: PageServerLoad = async ({ locals, url }) => {
  const entity = await entitasCetak(locals, url);
  const periode = periodeDari(url);
  return { entity, periode, ...(await muatRekapPengeluaran(locals.supabase, entity.id, periode)) };
};
