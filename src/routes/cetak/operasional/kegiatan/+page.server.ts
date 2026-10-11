import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { entitasCetak } from '$lib/server/cetak';
import { muatDetailKegiatan } from '$lib/server/detail-kegiatan';

/** LAPORAN BIAYA & OPERASIONAL KAPAL — OperasionalController::cetak, same rows as Detail Kegiatan Kapal. */
export const load: PageServerLoad = async ({ locals, url }) => {
  const entity = await entitasCetak(locals, url);
  const periode = periodeDari(url);
  const kapalFilter = Number(url.searchParams.get('kapal')) || null;
  const semua = await muatDetailKegiatan(locals.supabase, entity.id, periode);
  const baris = kapalFilter ? semua.filter((r) => r.kapal_id === kapalFilter) : semua;
  return { entity, periode, baris, namaKapalFilter: kapalFilter ? (baris[0]?.nama_kapal ?? null) : null };
};
