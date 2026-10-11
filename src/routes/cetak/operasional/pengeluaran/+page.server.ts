import type { PageServerLoad } from './$types';
import { periodeDari, rentangBulan } from '$lib/operasional/kegiatan';
import { entitasCetak } from '$lib/server/cetak';
import { failLoad } from '$lib/server/operasional';

/** Rekapan Pengeluaran — PengeluaranController::cetak. */
export const load: PageServerLoad = async ({ locals, url }) => {
  const entity = await entitasCetak(locals, url);
  const periode = periodeDari(url);
  const { dari, sampai } = rentangBulan(periode);
  const { data, error } = await locals.supabase
    .from('pengeluaran')
    .select('id, tanggal, jenis, nama_kegiatan, penerima, keterangan, jumlah')
    .eq('entity_id', entity.id)
    .gte('tanggal', dari)
    .lt('tanggal', sampai)
    .order('tanggal', { ascending: false })
    .order('id', { ascending: false })
    .returns<{ id: number; tanggal: string; jenis: string; nama_kegiatan: string | null; penerima: string | null; keterangan: string | null; jumlah: string }[]>();
  if (error) failLoad('cetak pengeluaran', error);
  const baris = (data ?? []).map((r) => ({ ...r, jumlah: Number(r.jumlah) }));
  return { entity, periode, baris, total: baris.reduce((s, r) => s + r.jumlah, 0) };
};
