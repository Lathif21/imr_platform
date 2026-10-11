import type { PageServerLoad } from './$types';
import { periodeDari, rentangBulan } from '$lib/operasional/kegiatan';
import { failLoad } from '$lib/server/operasional';

/**
 * Detail Kegiatan Kapal — OperasionalController::index.
 *
 * One row per kegiatan. Each figure prefers the sum of its trucks and falls
 * back to the stored rekap figure when the trucks give 0, as in Laravel. With
 * every truck tied to its kegiatan the two agree; the fallback matters only
 * for migrated rows whose trucks were never entered.
 *
 * Biaya operasional is NOT estimated. Laravel showed tonase × 1.000 when it
 * was empty and counted it in the total, while the financial report reads
 * the stored figure — the same kegiatan showed two different costs. Here an
 * empty figure is shown as empty, with the estimate as a hint, and the total
 * is what the report will read.
 */
export interface DetailRow {
  id: number;
  kapal_id: number;
  nama_kapal: string;
  rute: string | null;
  trips: number;
  tonase: number;
  sangu_supir: number;
  terpal: number;
  operasional: number;
  total: number;
  telly: string | null;
  tanggal_kegiatan: string | null;
  tanggal_selesai: string | null;
  keterangan: string | null;
  jumlah_truk: number;
}

interface RekapRecord {
  id: number;
  kapal_id: number;
  rute: string | null;
  trips: number | null;
  tonase: string | null;
  sangu_supir: string | null;
  terpal: string | null;
  operasional: string;
  telly_id: number | null;
  tanggal_kegiatan: string | null;
  tanggal_selesai: string | null;
  keterangan: string | null;
}

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  const kapalFilter = Number(url.searchParams.get('kapal')) || null;
  const kosong = { periode, kapalFilter, baris: [] as DetailRow[], kapalBulanIni: [] as { id: number; nama: string }[] };
  if (!opEntity) return kosong;

  const db = locals.supabase;
  const { dari, sampai } = rentangBulan(periode);

  const [rekapResult, transaksiResult, kapalResult, karyawanResult] = await Promise.all([
    db
      .from('operasional_rekap')
      .select('id, kapal_id, rute, trips, tonase, sangu_supir, terpal, operasional, telly_id, tanggal_kegiatan, tanggal_selesai, keterangan')
      .eq('entity_id', opEntity.id)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .returns<RekapRecord[]>(),
    db
      .from('transaksi_operasional')
      .select('operasional_rekap_id, ritase, tonase, sangu_supir, terpal')
      .eq('entity_id', opEntity.id)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .not('operasional_rekap_id', 'is', null)
      .returns<{ operasional_rekap_id: number; ritase: number; tonase: string; sangu_supir: string; terpal: string }[]>(),
    db.from('kapal').select('id, nama_kapal').eq('entity_id', opEntity.id).returns<{ id: number; nama_kapal: string }[]>(),
    db.from('karyawan').select('id, nama').eq('entity_id', opEntity.id).returns<{ id: number; nama: string }[]>()
  ]);

  if (rekapResult.error) failLoad('operasional_rekap', rekapResult.error);
  if (transaksiResult.error) failLoad('transaksi_operasional', transaksiResult.error);
  if (kapalResult.error) failLoad('kapal', kapalResult.error);
  if (karyawanResult.error) failLoad('karyawan', karyawanResult.error);

  const namaKapal = new Map((kapalResult.data ?? []).map((k) => [k.id, k.nama_kapal]));
  const namaKaryawan = new Map((karyawanResult.data ?? []).map((k) => [k.id, k.nama]));

  const agregat = new Map<number, { trips: number; tonase: number; sangu: number; terpal: number; jumlah: number }>();
  for (const t of transaksiResult.data ?? []) {
    const a = agregat.get(t.operasional_rekap_id) ?? { trips: 0, tonase: 0, sangu: 0, terpal: 0, jumlah: 0 };
    a.trips += t.ritase;
    a.tonase += Number(t.tonase);
    a.sangu += Number(t.sangu_supir);
    a.terpal += Number(t.terpal);
    a.jumlah += 1;
    agregat.set(t.operasional_rekap_id, a);
  }

  const lebihDariNol = (general: number | undefined, manual: string | number | null) =>
    general !== undefined && general > 0 ? general : Number(manual ?? 0);

  const semua: DetailRow[] = (rekapResult.data ?? []).map((r) => {
    const g = agregat.get(r.id);
    const sangu = lebihDariNol(g?.sangu, r.sangu_supir);
    const terpal = lebihDariNol(g?.terpal, r.terpal);
    const operasional = Number(r.operasional);
    return {
      id: r.id,
      kapal_id: r.kapal_id,
      nama_kapal: namaKapal.get(r.kapal_id) ?? '—',
      rute: r.rute,
      trips: lebihDariNol(g?.trips, r.trips),
      tonase: lebihDariNol(g?.tonase, r.tonase),
      sangu_supir: sangu,
      terpal,
      operasional,
      total: sangu + terpal + operasional,
      telly: r.telly_id === null ? null : (namaKaryawan.get(r.telly_id) ?? null),
      tanggal_kegiatan: r.tanggal_kegiatan,
      tanggal_selesai: r.tanggal_selesai,
      keterangan: r.keterangan,
      jumlah_truk: g?.jumlah ?? 0
    };
  });

  semua.sort((a, b) => a.nama_kapal.localeCompare(b.nama_kapal, 'id') || a.id - b.id);

  const kapalBulanIni = [...new Map(semua.map((r) => [r.kapal_id, r.nama_kapal])).entries()]
    .map(([id, nama]) => ({ id, nama }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));

  return {
    ...kosong,
    kapalBulanIni,
    baris: kapalFilter ? semua.filter((r) => r.kapal_id === kapalFilter) : semua
  };
};
