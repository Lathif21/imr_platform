import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { muatLaporanKeuangan, type BarisPengeluaran, type BarisTransaksiKeuangan } from '$lib/server/laporan-operasional';

/** Laporan Keuangan. The figures come from muatLaporanKeuangan(), shared with the Excel export. */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  if (!opEntity) return { periode, transaksi: [] as BarisTransaksiKeuangan[], pengeluaran: [] as BarisPengeluaran[] };
  return { periode, ...(await muatLaporanKeuangan(locals.supabase, opEntity.id, periode)) };
};
