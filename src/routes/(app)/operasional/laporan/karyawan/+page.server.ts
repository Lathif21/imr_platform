import type { PageServerLoad } from './$types';
import { filterDari, muatLaporanKaryawan, type BarisKaryawan } from '$lib/server/karyawan-laporan';

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const filter = filterDari(url);
  if (!opEntity) return { filter, karyawan: [] as BarisKaryawan[] };
  return { filter, karyawan: await muatLaporanKaryawan(locals.supabase, opEntity.id, filter) };
};
