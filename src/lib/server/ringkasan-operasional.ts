/**
 * Entities × months, from the operational input: what was invoiced, what it
 * cost, and the net result. The only place these figures are computed —
 * the Dasbor Operasional (one entity, one month) and the Ringkasan Eksekutif
 * (every entity, six months) both call it, so they cannot disagree.
 *
 * Laba bersih (decided 16 Oktober 2026, ASSUMPTIONS.md A-4):
 *
 *   tagihan bruto − pajak − pengeluaran kotor
 *
 * over EVERY invoice of the month, paid or not — accrual. Money not yet
 * received is shown beside it as piutang, not subtracted from it. Tax is the
 * rate the admin set on each invoice. Before the 65/35 profit split (A-3),
 * which the operational data does not record.
 *
 * Kumpulan Laporan keeps its own basis — paid invoices only — and says so on
 * the page; it is the field report, not this figure.
 *
 * Read in one batch — about ten queries however many entities and months —
 * then cut per entity and month and handed to the same pure functions the
 * Detail Kegiatan and Gaji screens use. Every read goes through the caller's
 * client, so RLS decides whose numbers these are.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { rentangBulan, type Periode } from '$lib/operasional/kegiatan';
import { ringkas } from '$lib/operasional/pendapatan';
import { susunDetailKegiatan, type BahanDetailKegiatan, type DetailRow } from '$lib/server/detail-kegiatan';
import { susunGaji, type BahanGaji } from '$lib/server/gaji';
import { failLoad } from '$lib/server/operasional';

const n = (v: unknown) => Number(v ?? 0) || 0;
const pad = (v: number) => String(v).padStart(2, '0');
const kunci = (p: Periode) => `${p.tahun}-${pad(p.bulan)}`;
/** The Jakarta month of a timestamp — gaji admin is dated by created_at. */
const bulanJakarta = (iso: string) => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 7);
const jakartaIso = (tanggal: string) => new Date(Date.parse(`${tanggal}T00:00:00+07:00`)).toISOString();

export interface PosPengeluaran {
  label: string;
  nilai: number;
  /** Operasional screen that lists the rows behind this figure. */
  href: string;
}

function cek<T>(context: string, r: { data: T | null; error: PostgrestError | null }): T {
  if (r.error) failLoad(context, r.error);
  return (r.data ?? []) as T;
}

/** `.in()` with long id lists split, so no request URL grows past what a proxy accepts. */
async function dalamPotongan<T>(ids: number[], ambil: (potong: number[]) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>, context: string) {
  const hasil: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    hasil.push(...cek(context, await ambil(ids.slice(i, i + 200))));
  }
  return hasil;
}

type Rekap = BahanDetailKegiatan['rekap'][number] & { entity_id: string; bulan: number; tahun: number };
type Trx = {
  id: number;
  entity_id: string;
  tanggal: string;
  operasional_rekap_id: number | null;
  ritase: number;
  tonase: string;
  sangu_supir: string;
  terpal: string | null;
  pendapatan: string;
};

function hitungSatu(
  bahan: {
    detail: BahanDetailKegiatan;
    gaji: BahanGaji;
    pendapatan: Record<string, string | null>[];
    trx: Trx[];
    paguyuban: number;
    pengeluaranManual: number;
  }
) {
  const kegiatan: DetailRow[] = susunDetailKegiatan(bahan.detail);
  const gaji = susunGaji(bahan.gaji);
  const pendapatan = ringkas(
    bahan.pendapatan.map((r) => ({
      party_kg: n(r.party_kg),
      total: n(r.total),
      pajak: n(r.pajak),
      net_tagihan: n(r.net_tagihan),
      status_entry: r.status_entry,
      payment_date: r.payment_date
    }))
  );

  const bebanRekanan = bahan.trx.reduce((s, t) => s + n(t.pendapatan), 0);
  const honorTelly = gaji.ringkas.filter((r) => !r.admin).reduce((s, r) => s + r.gaji_bersih, 0);
  const gajiAdmin = gaji.ringkas.filter((r) => r.admin).reduce((s, r) => s + r.gaji_bersih, 0);
  const pengeluaran: PosPengeluaran[] = [
    { label: 'Beban rekanan (ongkos angkut)', nilai: bebanRekanan, href: 'laporan/partner' },
    { label: 'Saku supir', nilai: kegiatan.reduce((s, k) => s + k.sangu_supir, 0), href: 'kegiatan' },
    { label: 'Terpal', nilai: kegiatan.reduce((s, k) => s + k.terpal, 0), href: 'kegiatan' },
    { label: 'Biaya operasional kegiatan', nilai: kegiatan.reduce((s, k) => s + k.operasional, 0), href: 'kegiatan' },
    { label: 'Iuran paguyuban', nilai: bahan.paguyuban, href: 'laporan/paguyuban' },
    { label: 'Honor telly', nilai: honorTelly, href: 'laporan/gaji' },
    { label: 'Gaji admin', nilai: gajiAdmin, href: 'laporan/gaji' },
    { label: 'Pengeluaran manual', nilai: bahan.pengeluaranManual, href: 'pengeluaran' }
  ];
  const totalPengeluaran = pengeluaran.reduce((s, p) => s + p.nilai, 0);

  return {
    kegiatan,
    gaji,
    pendapatan,
    pengeluaran,
    totalPengeluaran,
    bebanRekanan,
    labaBersih: pendapatan.semua.total - pendapatan.semua.pajak - totalPengeluaran,
    volume: {
      kegiatan: kegiatan.length,
      truk: kegiatan.reduce((s, k) => s + k.jumlah_truk, 0),
      ritase: kegiatan.reduce((s, k) => s + k.trips, 0),
      tonase: kegiatan.reduce((s, k) => s + k.tonase, 0)
    }
  };
}

export type HasilBulan = ReturnType<typeof hitungSatu>;

/**
 * Every entity × every month in one read. The result is keyed
 * `${entityId}|YYYY-MM`; a month with no input is present, with zeros.
 */
export async function hitungBanyak(
  db: SupabaseClient,
  entityIds: string[],
  periodes: Periode[]
): Promise<Map<string, HasilBulan>> {
  const hasil = new Map<string, HasilBulan>();
  if (entityIds.length === 0 || periodes.length === 0) return hasil;

  const urut = [...periodes].sort((a, b) => a.tahun * 12 + a.bulan - (b.tahun * 12 + b.bulan));
  const { dari } = rentangBulan(urut[0]);
  const { sampai } = rentangBulan(urut[urut.length - 1]);
  const tahunAwal = urut[0].tahun;
  const tahunAkhir = urut[urut.length - 1].tahun;

  const [rekapR, trxR, kapalR, karyawanR, adminR, lpR, keluarR] = await Promise.all([
    db
      .from('operasional_rekap')
      .select('id, entity_id, bulan, tahun, kapal_id, rute, trips, tonase, sangu_supir, terpal, operasional, telly_id, tanggal_kegiatan, tanggal_selesai, keterangan')
      .in('entity_id', entityIds)
      .gte('tahun', tahunAwal)
      .lte('tahun', tahunAkhir)
      .returns<Rekap[]>(),
    db
      .from('transaksi_operasional')
      .select('id, entity_id, tanggal, operasional_rekap_id, ritase, tonase, sangu_supir, terpal, pendapatan')
      .in('entity_id', entityIds)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .returns<Trx[]>(),
    db.from('kapal').select('id, entity_id, nama_kapal').in('entity_id', entityIds)
      .returns<{ id: number; entity_id: string; nama_kapal: string }[]>(),
    db
      .from('karyawan')
      .select('id, entity_id, nama, jabatan, ktp, npwp, status')
      .in('entity_id', entityIds)
      .order('nama')
      .returns<(BahanGaji['karyawan'][number] & { entity_id: string })[]>(),
    db
      .from('gaji_telly')
      .select('id, entity_id, karyawan_id, gaji_total, pph, gaji_bersih, keterangan, created_at')
      .in('entity_id', entityIds)
      .is('operasional_rekap_id', null)
      .is('transaksi_id', null)
      .gte('created_at', jakartaIso(dari))
      .lt('created_at', jakartaIso(sampai))
      .order('id')
      .returns<(BahanGaji['admin'][number] & { entity_id: string; created_at: string })[]>(),
    db
      .from('laporan_pendapatan')
      .select('entity_id, bulan, tahun, party_kg, total, pajak, net_tagihan, status_entry, payment_date')
      .in('entity_id', entityIds)
      .gte('tahun', tahunAwal)
      .lte('tahun', tahunAkhir)
      .returns<Record<string, string | null>[]>(),
    db
      .from('pengeluaran')
      .select('entity_id, tanggal, jumlah')
      .in('entity_id', entityIds)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .returns<{ entity_id: string; tanggal: string; jumlah: string }[]>()
  ]);

  const rekap = cek('ringkasan rekap', rekapR);
  const trx = cek('ringkasan transaksi', trxR);
  const kapal = cek('ringkasan kapal', kapalR);
  const karyawan = cek('ringkasan karyawan', karyawanR);
  const admin = cek('ringkasan gaji admin', adminR);
  const lp = cek('ringkasan pendapatan', lpR);
  const keluar = cek('ringkasan pengeluaran', keluarR);

  const diminta = new Set(urut.map(kunci));
  const rekapTelly = rekap.filter((r) => r.telly_id !== null && diminta.has(kunci(r)));
  const trxDiminta = trx.filter((t) => diminta.has(t.tanggal.slice(0, 7)));

  const [honor, paguyuban] = await Promise.all([
    dalamPotongan(
      rekapTelly.map((r) => r.id),
      (ids) =>
        db
          .from('gaji_telly')
          .select('id, karyawan_id, operasional_rekap_id, gaji, pph, keterangan')
          .in('operasional_rekap_id', ids)
          .returns<BahanGaji['honor']>(),
      'ringkasan honor'
    ),
    dalamPotongan(
      trxDiminta.map((t) => t.id),
      (ids) =>
        db
          .from('paguyuban')
          .select('transaksi_id, total_bayar')
          .in('transaksi_id', ids)
          .returns<{ transaksi_id: number; total_bayar: string }[]>(),
      'ringkasan paguyuban'
    )
  ]);

  const paguyubanPerTrx = new Map<number, number>();
  for (const p of paguyuban) paguyubanPerTrx.set(p.transaksi_id, (paguyubanPerTrx.get(p.transaksi_id) ?? 0) + n(p.total_bayar));

  for (const entityId of entityIds) {
    const kapalE = kapal.filter((k) => k.entity_id === entityId);
    const karyawanE = karyawan.filter((k) => k.entity_id === entityId);
    for (const p of urut) {
      const k = kunci(p);
      const rekapEM = rekap.filter((r) => r.entity_id === entityId && kunci(r) === k);
      const trxEM = trxDiminta.filter((t) => t.entity_id === entityId && t.tanggal.slice(0, 7) === k);
      const rekapTellyEM = rekapEM.filter((r) => r.telly_id !== null);
      const idTelly = new Set(rekapTellyEM.map((r) => r.id));
      hasil.set(
        `${entityId}|${k}`,
        hitungSatu({
          detail: {
            rekap: rekapEM,
            transaksi: trxEM
              .filter((t) => t.operasional_rekap_id !== null)
              .map((t) => ({ ...t, operasional_rekap_id: t.operasional_rekap_id as number })),
            kapal: kapalE,
            karyawan: karyawanE
          },
          gaji: {
            karyawan: karyawanE,
            rekap: rekapTellyEM.map((r) => ({ ...r, tonase: r.tonase ?? '0', telly_id: r.telly_id as number })),
            admin: admin.filter((a) => a.entity_id === entityId && bulanJakarta(a.created_at) === k),
            kapal: kapalE,
            honor: honor.filter((h) => idTelly.has(h.operasional_rekap_id))
          },
          pendapatan: lp.filter((r) => r.entity_id === entityId && `${r.tahun}-${pad(Number(r.bulan))}` === k),
          trx: trxEM,
          paguyuban: trxEM.reduce((s, t) => s + (paguyubanPerTrx.get(t.id) ?? 0), 0),
          pengeluaranManual: keluar
            .filter((e) => e.entity_id === entityId && e.tanggal.slice(0, 7) === k)
            .reduce((s, e) => s + n(e.jumlah), 0)
        })
      );
    }
  }
  return hasil;
}

/** One entity, one month — the Dasbor Operasional. */
export async function hitungBulan(db: SupabaseClient, entityId: string, periode: Periode): Promise<HasilBulan> {
  const hasil = await hitungBanyak(db, [entityId], [periode]);
  return hasil.get(`${entityId}|${kunci(periode)}`)!;
}

export const kunciHasil = (entityId: string, periode: Periode) => `${entityId}|${kunci(periode)}`;
