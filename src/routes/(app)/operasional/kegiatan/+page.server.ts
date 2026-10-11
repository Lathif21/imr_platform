import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { muatDetailKegiatan, type DetailRow } from '$lib/server/detail-kegiatan';

/** Detail Kegiatan Kapal — OperasionalController::index. Rules: $lib/server/detail-kegiatan.ts. */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  const kapalFilter = Number(url.searchParams.get('kapal')) || null;
  const kosong = { periode, kapalFilter, baris: [] as DetailRow[], kapalBulanIni: [] as { id: number; nama: string }[] };
  if (!opEntity) return kosong;

  const semua = await muatDetailKegiatan(locals.supabase, opEntity.id, periode);
  const kapalBulanIni = [...new Map(semua.map((r) => [r.kapal_id, r.nama_kapal])).entries()]
    .map(([id, nama]) => ({ id, nama }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));

  return {
    ...kosong,
    kapalBulanIni,
    baris: kapalFilter ? semua.filter((r) => r.kapal_id === kapalFilter) : semua
  };
};
