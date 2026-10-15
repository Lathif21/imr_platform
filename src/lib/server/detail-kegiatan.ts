import type { SupabaseClient } from '@supabase/supabase-js';
import { rentangBulan, type Periode } from '$lib/operasional/kegiatan';
import { failLoad } from './operasional';

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
  /** False while Lengkapi Data has not set it; `operasional` is then 0. */
  operasional_diisi: boolean;
  total: number;
  telly: string | null;
  tanggal_kegiatan: string | null;
  tanggal_selesai: string | null;
  keterangan: string | null;
  jumlah_truk: number;
}

export interface RekapRecord {
  id: number;
  kapal_id: number;
  rute: string | null;
  trips: number | null;
  tonase: string | null;
  sangu_supir: string | null;
  terpal: string | null;
  operasional: string | null;
  telly_id: number | null;
  tanggal_kegiatan: string | null;
  tanggal_selesai: string | null;
  keterangan: string | null;
}

/** Every kegiatan of the month, as Detail Kegiatan Kapal shows it, sorted by ship. */
export async function muatDetailKegiatan(db: SupabaseClient, entityId: string, periode: Periode): Promise<DetailRow[]> {
  const { dari, sampai } = rentangBulan(periode);

  const [rekapResult, transaksiResult, kapalResult, karyawanResult] = await Promise.all([
    db
      .from('operasional_rekap')
      .select('id, kapal_id, rute, trips, tonase, sangu_supir, terpal, operasional, telly_id, tanggal_kegiatan, tanggal_selesai, keterangan')
      .eq('entity_id', entityId)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .returns<RekapRecord[]>(),
    db
      .from('transaksi_operasional')
      .select('operasional_rekap_id, ritase, tonase, sangu_supir, terpal')
      .eq('entity_id', entityId)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .not('operasional_rekap_id', 'is', null)
      .returns<{ operasional_rekap_id: number; ritase: number; tonase: string; sangu_supir: string; terpal: string | null }[]>(),
    db.from('kapal').select('id, nama_kapal').eq('entity_id', entityId).returns<{ id: number; nama_kapal: string }[]>(),
    db.from('karyawan').select('id, nama').eq('entity_id', entityId).returns<{ id: number; nama: string }[]>()
  ]);

  if (rekapResult.error) failLoad('operasional_rekap', rekapResult.error);
  if (transaksiResult.error) failLoad('transaksi_operasional', transaksiResult.error);
  if (kapalResult.error) failLoad('kapal', kapalResult.error);
  if (karyawanResult.error) failLoad('karyawan', karyawanResult.error);

  return susunDetailKegiatan({
    rekap: rekapResult.data ?? [],
    transaksi: transaksiResult.data ?? [],
    kapal: kapalResult.data ?? [],
    karyawan: karyawanResult.data ?? []
  });
}

export interface BahanDetailKegiatan {
  /** The month's kegiatan of one entity. */
  rekap: RekapRecord[];
  /** The month's trucks tied to a kegiatan (operasional_rekap_id not null). */
  transaksi: { operasional_rekap_id: number; ritase: number; tonase: string; sangu_supir: string; terpal: string | null }[];
  kapal: { id: number; nama_kapal: string }[];
  karyawan: { id: number; nama: string }[];
}

/**
 * The rows, from rows already read. Pure, so the Ringkasan Eksekutif can read
 * many entities and months at once and still compute exactly this.
 */
export function susunDetailKegiatan({ rekap, transaksi, kapal, karyawan }: BahanDetailKegiatan): DetailRow[] {
  const namaKapal = new Map(kapal.map((k) => [k.id, k.nama_kapal]));
  const namaKaryawan = new Map(karyawan.map((k) => [k.id, k.nama]));

  const agregat = new Map<number, { trips: number; tonase: number; sangu: number; terpal: number; jumlah: number }>();
  for (const t of transaksi) {
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

  const semua: DetailRow[] = rekap.map((r) => {
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
      operasional_diisi: r.operasional !== null,
      total: sangu + terpal + operasional,
      telly: r.telly_id === null ? null : (namaKaryawan.get(r.telly_id) ?? null),
      tanggal_kegiatan: r.tanggal_kegiatan,
      tanggal_selesai: r.tanggal_selesai,
      keterangan: r.keterangan,
      jumlah_truk: g?.jumlah ?? 0
    };
  });

  semua.sort((a, b) => a.nama_kapal.localeCompare(b.nama_kapal, 'id') || a.id - b.id);
  return semua;
}
