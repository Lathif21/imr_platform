import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { muatPaguyuban, type GrupPaguyuban } from '$lib/server/laporan-operasional';

/** Laporan Paguyuban. The figures come from muatPaguyuban(), shared with the Excel export. */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  const dipilih = url.searchParams.get('paguyuban');
  const kosong = {
    periode,
    dipilih,
    grup: [] as GrupPaguyuban[],
    rincian: [] as { tanggal: string; kapal: string; nopol: string; tonase: number; tarif: number; total: number }[],
    kapalGrup: [] as { nama_kapal: string; kapasitas_ton: number | null; total: number }[]
  };
  if (!opEntity) return kosong;

  const { grup, baris, kapalGrup } = await muatPaguyuban(locals.supabase, opEntity.id, periode);
  return {
    ...kosong,
    grup,
    rincian: dipilih ? baris.filter((b) => b.kunci === dipilih).map(({ kunci: _k, kapal_id: _i, ...r }) => r) : [],
    kapalGrup: dipilih ? kapalGrup(dipilih) : []
  };
};
