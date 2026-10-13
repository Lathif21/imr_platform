/**
 * Data for the monthly operational reports that used to load inline in their
 * page: Paguyuban, Operasional, Keuangan, Pendapatan, Pengeluaran. Moved here
 * unchanged so the screen, the printout and the Excel export read the same
 * numbers from one place.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { rentangBulan, type Periode } from '$lib/operasional/kegiatan';
import { ringkas } from '$lib/operasional/pendapatan';
import { muatDetailKegiatan, type DetailRow } from './detail-kegiatan';
import { failLoad } from './operasional';

// ---------------------------------------------------------------------------
// Paguyuban — LaporanController::paguyuban
// ---------------------------------------------------------------------------

/**
 * Iuran per truck (paguyuban.total_bayar = tonase × tarif), grouped by the
 * ship's nama_paguyuban.
 *
 * Laravel listed only ships that have a nama_paguyuban, but no screen saves
 * that column (KapalController ignores it), so every ship added since sits
 * outside every group and its fees vanished from this report while still
 * being charged. Here they appear as "(Tanpa nama paguyuban)", so the total
 * matches what was actually charged.
 */
export const TANPA_PAGUYUBAN = '__tanpa__';

export interface BarisIuran {
  kunci: string;
  kapal_id: number;
  tanggal: string;
  kapal: string;
  nopol: string;
  tonase: number;
  tarif: number;
  total: number;
}

export interface GrupPaguyuban {
  kunci: string;
  nama: string;
  kapal: number;
  transaksi: number;
  tonase: number;
  total: number;
}

export async function muatPaguyuban(db: SupabaseClient, entityId: string, periode: Periode) {
  const { dari, sampai } = rentangBulan(periode);
  const [trxResult, kapalResult, kendaraanResult] = await Promise.all([
    db
      .from('transaksi_operasional')
      .select('id, kapal_id, kendaraan_id, tanggal, tonase')
      .eq('entity_id', entityId)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .order('tanggal')
      .returns<{ id: number; kapal_id: number; kendaraan_id: number | null; tanggal: string; tonase: string }[]>(),
    db
      .from('kapal')
      .select('id, nama_kapal, nama_paguyuban, kapasitas_ton')
      .eq('entity_id', entityId)
      .order('nama_kapal')
      .returns<{ id: number; nama_kapal: string; nama_paguyuban: string | null; kapasitas_ton: string | null }[]>(),
    db.from('kendaraan').select('id, nopol').eq('entity_id', entityId).returns<{ id: number; nopol: string }[]>()
  ]);
  if (trxResult.error) failLoad('paguyuban transaksi', trxResult.error);
  if (kapalResult.error) failLoad('paguyuban kapal', kapalResult.error);
  if (kendaraanResult.error) failLoad('paguyuban kendaraan', kendaraanResult.error);

  const trx = trxResult.data ?? [];
  const { data: iuran, error } = await db
    .from('paguyuban')
    .select('transaksi_id, tarif, total_bayar')
    .in('transaksi_id', trx.map((t) => t.id))
    .returns<{ transaksi_id: number; tarif: string; total_bayar: string }[]>();
  if (error) failLoad('paguyuban', error);

  const kapalRows = kapalResult.data ?? [];
  const kapal = new Map(kapalRows.map((k) => [k.id, k]));
  const nopol = new Map((kendaraanResult.data ?? []).map((k) => [k.id, k.nopol]));
  const perTrx = new Map((iuran ?? []).map((p) => [p.transaksi_id, p]));
  const kunciKapal = (id: number) => {
    const nama = kapal.get(id)?.nama_paguyuban?.trim();
    return nama ? nama : TANPA_PAGUYUBAN;
  };

  const baris: BarisIuran[] = trx
    .filter((t) => perTrx.has(t.id))
    .map((t) => {
      const p = perTrx.get(t.id)!;
      return {
        kunci: kunciKapal(t.kapal_id),
        kapal_id: t.kapal_id,
        tanggal: t.tanggal,
        kapal: kapal.get(t.kapal_id)?.nama_kapal ?? '—',
        nopol: t.kendaraan_id === null ? '—' : (nopol.get(t.kendaraan_id) ?? '—'),
        tonase: Number(t.tonase),
        tarif: Number(p.tarif),
        total: Number(p.total_bayar)
      };
    });

  const kunciSemua = new Set([...kapalRows.map((k) => kunciKapal(k.id)), ...baris.map((b) => b.kunci)]);
  const grup: GrupPaguyuban[] = [...kunciSemua]
    .map((kunci) => {
      const rows = baris.filter((b) => b.kunci === kunci);
      return {
        kunci,
        nama: kunci === TANPA_PAGUYUBAN ? '(Tanpa nama paguyuban)' : kunci,
        kapal: kapalRows.filter((k) => kunciKapal(k.id) === kunci).length,
        transaksi: rows.length,
        tonase: rows.reduce((s, r) => s + r.tonase, 0),
        total: rows.reduce((s, r) => s + r.total, 0)
      };
    })
    .filter((g) => g.kunci !== TANPA_PAGUYUBAN || g.transaksi > 0)
    .sort((a, b) =>
      a.kunci === TANPA_PAGUYUBAN ? 1 : b.kunci === TANPA_PAGUYUBAN ? -1 : a.nama.localeCompare(b.nama, 'id')
    );

  /** Ships of one group with their fee total, for the group's detail view. */
  const kapalGrup = (dipilih: string) =>
    kapalRows
      .filter((k) => kunciKapal(k.id) === dipilih)
      .map((k) => ({
        nama_kapal: k.nama_kapal,
        kapasitas_ton: k.kapasitas_ton === null ? null : Number(k.kapasitas_ton),
        total: baris.filter((r) => r.kunci === dipilih && r.kapal_id === k.id).reduce((s, r) => s + r.total, 0)
      }));

  return { grup, baris, kapalGrup };
}

// ---------------------------------------------------------------------------
// Operasional — LaporanController::operasional
// ---------------------------------------------------------------------------

/**
 * A summary per ship and the cost of every kegiatan.
 *
 * Laravel's summary had "Pendapatan" and "Laba = Pendapatan − Biaya", where
 * pendapatan was transaksi.pendapatan — the payment to truck owners. That is
 * a cost, so "laba" subtracted a cost from a cost (10-integrasi-
 * operasional.md). The same figure is shown here as Beban Rekanan among the
 * costs, and there is no laba column; the P&L lives in Laporan P&L.
 * Laravel also took honor telly from per-truck rows only, which no screen
 * creates any more; it is read from the per-kegiatan rows.
 */
export interface RingkasKapal {
  kapal_id: number;
  nama_kapal: string;
  kegiatan: number;
  truk: number;
  ritase: number;
  tonase: number;
  rekanan: number;
  sangu_supir: number;
  terpal: number;
  operasional: number;
  paguyuban: number;
  telly: number;
  total: number;
}

export async function muatLaporanOperasional(
  db: SupabaseClient,
  entityId: string,
  periode: Periode
): Promise<{ ringkas: RingkasKapal[]; kegiatan: DetailRow[] }> {
  const { dari, sampai } = rentangBulan(periode);
  const kegiatan = await muatDetailKegiatan(db, entityId, periode);

  const { data: trx, error } = await db
    .from('transaksi_operasional')
    .select('id, kapal_id, pendapatan')
    .eq('entity_id', entityId)
    .gte('tanggal', dari)
    .lt('tanggal', sampai)
    .returns<{ id: number; kapal_id: number; pendapatan: string }[]>();
  if (error) failLoad('laporan operasional transaksi', error);

  const [pagResult, tellyResult] = await Promise.all([
    db.from('paguyuban').select('transaksi_id, total_bayar').in('transaksi_id', (trx ?? []).map((t) => t.id)).returns<{ transaksi_id: number; total_bayar: string }[]>(),
    db.from('gaji_telly').select('operasional_rekap_id, gaji_bersih').in('operasional_rekap_id', kegiatan.map((k) => k.id)).returns<{ operasional_rekap_id: number; gaji_bersih: string }[]>()
  ]);
  if (pagResult.error) failLoad('laporan operasional paguyuban', pagResult.error);
  if (tellyResult.error) failLoad('laporan operasional telly', tellyResult.error);

  const kapalTrx = new Map((trx ?? []).map((t) => [t.id, t.kapal_id]));
  const kapalRekap = new Map(kegiatan.map((k) => [k.id, k.kapal_id]));
  const per = new Map<number, RingkasKapal>();
  const ambil = (kapalId: number, nama = '—') => {
    const r =
      per.get(kapalId) ??
      { kapal_id: kapalId, nama_kapal: nama, kegiatan: 0, truk: 0, ritase: 0, tonase: 0, rekanan: 0, sangu_supir: 0, terpal: 0, operasional: 0, paguyuban: 0, telly: 0, total: 0 };
    per.set(kapalId, r);
    return r;
  };

  for (const k of kegiatan) {
    const r = ambil(k.kapal_id, k.nama_kapal);
    r.kegiatan += 1;
    r.truk += k.jumlah_truk;
    r.ritase += k.trips;
    r.tonase += k.tonase;
    r.sangu_supir += k.sangu_supir;
    r.terpal += k.terpal;
    r.operasional += k.operasional;
  }
  for (const t of trx ?? []) ambil(t.kapal_id).rekanan += Number(t.pendapatan);
  for (const p of pagResult.data ?? []) {
    const kapalId = kapalTrx.get(p.transaksi_id);
    if (kapalId !== undefined) ambil(kapalId).paguyuban += Number(p.total_bayar);
  }
  for (const g of tellyResult.data ?? []) {
    const kapalId = kapalRekap.get(g.operasional_rekap_id);
    if (kapalId !== undefined) ambil(kapalId).telly += Number(g.gaji_bersih);
  }
  for (const r of per.values()) r.total = r.rekanan + r.sangu_supir + r.terpal + r.operasional + r.paguyuban + r.telly;

  return {
    kegiatan,
    ringkas: [...per.values()].sort((a, b) => a.nama_kapal.localeCompare(b.nama_kapal, 'id'))
  };
}

// ---------------------------------------------------------------------------
// Keuangan — LaporanController::keuangan
// ---------------------------------------------------------------------------

export interface BarisTransaksiKeuangan {
  id: number;
  tanggal: string;
  kapal: string;
  nopol: string;
  rekanan: number;
  biaya: number;
}

export interface BarisPengeluaran {
  id: number;
  tanggal: string;
  jenis: string;
  nama_kegiatan: string | null;
  penerima: string | null;
  keterangan?: string | null;
  jumlah: number;
}

/**
 * The month's truck rows and manual expenses, nothing more. Laravel's
 * controller used to compute a "laba bersih" from transaksi.pendapatan, which
 * is a payment to truck owners; it was already removed there and is not
 * ported (10-integrasi-operasional.md).
 *
 * Biaya lapangan per truck as TransaksiOperasional::total_biaya: saku +
 * terpal + operasional + honor telly of that truck + iuran paguyuban.
 */
export async function muatLaporanKeuangan(db: SupabaseClient, entityId: string, periode: Periode) {
  const { dari, sampai } = rentangBulan(periode);
  const [trxResult, keluarResult, kapalResult, kendaraanResult] = await Promise.all([
    db
      .from('transaksi_operasional')
      .select('id, tanggal, kapal_id, kendaraan_id, pendapatan, sangu_supir, terpal, operasional')
      .eq('entity_id', entityId)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .order('tanggal')
      .order('id')
      .returns<{ id: number; tanggal: string; kapal_id: number; kendaraan_id: number | null; pendapatan: string; sangu_supir: string; terpal: string; operasional: string }[]>(),
    db
      .from('pengeluaran')
      .select('id, tanggal, jenis, nama_kegiatan, penerima, jumlah')
      .eq('entity_id', entityId)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .order('tanggal')
      .returns<{ id: number; tanggal: string; jenis: string; nama_kegiatan: string | null; penerima: string | null; jumlah: string }[]>(),
    db.from('kapal').select('id, nama_kapal').eq('entity_id', entityId).returns<{ id: number; nama_kapal: string }[]>(),
    db.from('kendaraan').select('id, nopol').eq('entity_id', entityId).returns<{ id: number; nopol: string }[]>()
  ]);
  if (trxResult.error) failLoad('keuangan transaksi', trxResult.error);
  if (keluarResult.error) failLoad('keuangan pengeluaran', keluarResult.error);
  if (kapalResult.error) failLoad('keuangan kapal', kapalResult.error);
  if (kendaraanResult.error) failLoad('keuangan kendaraan', kendaraanResult.error);

  const trx = trxResult.data ?? [];
  const ids = trx.map((t) => t.id);
  const [pagResult, gajiResult] = await Promise.all([
    db.from('paguyuban').select('transaksi_id, total_bayar').in('transaksi_id', ids).returns<{ transaksi_id: number; total_bayar: string }[]>(),
    db.from('gaji_telly').select('transaksi_id, gaji_bersih').in('transaksi_id', ids).returns<{ transaksi_id: number; gaji_bersih: string }[]>()
  ]);
  if (pagResult.error) failLoad('keuangan paguyuban', pagResult.error);
  if (gajiResult.error) failLoad('keuangan gaji', gajiResult.error);

  const kapal = new Map((kapalResult.data ?? []).map((k) => [k.id, k.nama_kapal]));
  const nopol = new Map((kendaraanResult.data ?? []).map((k) => [k.id, k.nopol]));
  const pag = new Map((pagResult.data ?? []).map((p) => [p.transaksi_id, Number(p.total_bayar)]));
  const gaji = new Map((gajiResult.data ?? []).map((g) => [g.transaksi_id, Number(g.gaji_bersih)]));

  return {
    transaksi: trx.map(
      (t): BarisTransaksiKeuangan => ({
        id: t.id,
        tanggal: t.tanggal,
        kapal: kapal.get(t.kapal_id) ?? '—',
        nopol: t.kendaraan_id === null ? '—' : (nopol.get(t.kendaraan_id) ?? '—'),
        rekanan: Number(t.pendapatan),
        biaya: Number(t.sangu_supir) + Number(t.terpal) + Number(t.operasional) + (gaji.get(t.id) ?? 0) + (pag.get(t.id) ?? 0)
      })
    ),
    pengeluaran: (keluarResult.data ?? []).map((p): BarisPengeluaran => ({ ...p, jumlah: Number(p.jumlah) }))
  };
}

// ---------------------------------------------------------------------------
// Pendapatan — LaporanController::cetakPendapatan (REKAP INCOME)
// ---------------------------------------------------------------------------

interface TeksPendapatan {
  no_invoice: string | null;
  kegiatan: string;
  no_faktur_pajak: string | null;
  no_sto_spo: string | null;
  lokasi: string | null;
  tanggal_kegiatan: string | null;
  tanggal_entry: string | null;
}

type MentahPendapatan = TeksPendapatan & Record<'party_kg' | 'harga' | 'total' | 'pajak' | 'net_tagihan' | 'tarif_pajak', string> & {
  status_entry: string | null;
  payment_date: string | null;
};

/**
 * Laravel counted "belum terbayar" here as payment_date empty, while the
 * screen also excluded LUNAS; both now use sudahDibayar(), so the printout
 * and the screen agree.
 */
export async function muatRekapPendapatan(db: SupabaseClient, entityId: string, periode: Periode) {
  const [rows, all] = await Promise.all([
    db
      .from('laporan_pendapatan')
      .select('no_invoice, kegiatan, no_faktur_pajak, no_sto_spo, lokasi, tanggal_kegiatan, party_kg, harga, total, tarif_pajak, pajak, net_tagihan, status_entry, tanggal_entry, payment_date')
      .eq('entity_id', entityId)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .order('no_urut', { ascending: true, nullsFirst: false })
      .order('id')
      .returns<MentahPendapatan[]>(),
    db
      .from('laporan_pendapatan')
      .select('party_kg, total, pajak, net_tagihan, status_entry, payment_date')
      .eq('entity_id', entityId)
      .returns<Partial<MentahPendapatan>[]>()
  ]);
  if (rows.error) failLoad('rekap pendapatan', rows.error);
  if (all.error) failLoad('rekap pendapatan all', all.error);

  const angka = (r: Partial<MentahPendapatan>) => ({
    party_kg: Number(r.party_kg ?? 0),
    total: Number(r.total ?? 0),
    pajak: Number(r.pajak ?? 0),
    net_tagihan: Number(r.net_tagihan ?? 0),
    status_entry: r.status_entry ?? null,
    payment_date: r.payment_date ?? null
  });

  const baris = (rows.data ?? []).map((r) => ({
    ...r,
    ...angka(r),
    harga: Number(r.harga ?? 0),
    tarif_pajak: Number(r.tarif_pajak ?? 0)
  }));
  return { baris, bulanIni: ringkas(baris).semua, keseluruhan: ringkas((all.data ?? []).map(angka)) };
}

// ---------------------------------------------------------------------------
// Pengeluaran — PengeluaranController::cetak
// ---------------------------------------------------------------------------

export async function muatRekapPengeluaran(db: SupabaseClient, entityId: string, periode: Periode) {
  const { dari, sampai } = rentangBulan(periode);
  const { data, error } = await db
    .from('pengeluaran')
    .select('id, tanggal, jenis, nama_kegiatan, penerima, keterangan, jumlah')
    .eq('entity_id', entityId)
    .gte('tanggal', dari)
    .lt('tanggal', sampai)
    .order('tanggal', { ascending: false })
    .order('id', { ascending: false })
    .returns<{ id: number; tanggal: string; jenis: string; nama_kegiatan: string | null; penerima: string | null; keterangan: string | null; jumlah: string }[]>();
  if (error) failLoad('rekap pengeluaran', error);
  const baris = (data ?? []).map((r): BarisPengeluaran => ({ ...r, jumlah: Number(r.jumlah) }));
  return { baris, total: baris.reduce((s, r) => s + r.jumlah, 0) };
}
