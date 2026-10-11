import type { PageServerLoad } from './$types';
import { entitasCetak } from '$lib/server/cetak';
import { filterDari, muatLaporanKaryawan } from '$lib/server/karyawan-laporan';

/** karyawanCetak — the same filters as the screen. */
export const load: PageServerLoad = async ({ locals, url }) => {
  const entity = await entitasCetak(locals, url);
  const filter = filterDari(url);
  return { entity, filter, karyawan: await muatLaporanKaryawan(locals.supabase, entity.id, filter) };
};
