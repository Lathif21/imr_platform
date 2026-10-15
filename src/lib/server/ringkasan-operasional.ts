/**
 * One entity, one month, from the operational input: what was invoiced, what
 * it cost, and the net result. Shared by the Dasbor Operasional and the
 * Ringkasan Eksekutif so the two screens can never show different numbers
 * for the same month.
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
 * Every read goes through the caller's client, so RLS decides whose numbers
 * these are.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rentangBulan, type Periode } from '$lib/operasional/kegiatan';
import { ringkas } from '$lib/operasional/pendapatan';
import { muatDetailKegiatan } from '$lib/server/detail-kegiatan';
import { muatGaji } from '$lib/server/gaji';
import { failLoad } from '$lib/server/operasional';

const n = (v: unknown) => Number(v ?? 0) || 0;

export interface PosPengeluaran {
  label: string;
  nilai: number;
  /** Operasional screen that lists the rows behind this figure. */
  href: string;
}

export async function hitungBulan(db: SupabaseClient, entityId: string, periode: Periode) {
  const { dari, sampai } = rentangBulan(periode);

  const [kegiatan, gaji, lpResult, trxResult, keluarResult] = await Promise.all([
    muatDetailKegiatan(db, entityId, periode),
    muatGaji(db, entityId, periode),
    db
      .from('laporan_pendapatan')
      .select('party_kg, total, pajak, net_tagihan, status_entry, payment_date')
      .eq('entity_id', entityId)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .returns<Record<string, string | null>[]>(),
    db
      .from('transaksi_operasional')
      .select('id, pendapatan')
      .eq('entity_id', entityId)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .returns<{ id: number; pendapatan: string }[]>(),
    db
      .from('pengeluaran')
      .select('jenis, jumlah')
      .eq('entity_id', entityId)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .returns<{ jenis: string; jumlah: string }[]>()
  ]);
  if (lpResult.error) failLoad('ringkasan pendapatan', lpResult.error);
  if (trxResult.error) failLoad('ringkasan transaksi', trxResult.error);
  if (keluarResult.error) failLoad('ringkasan pengeluaran', keluarResult.error);

  const trx = trxResult.data ?? [];
  const { data: pag, error: pagError } = await db
    .from('paguyuban')
    .select('total_bayar')
    .in('transaksi_id', trx.map((t) => t.id))
    .returns<{ total_bayar: string }[]>();
  if (pagError) failLoad('ringkasan paguyuban', pagError);

  const pendapatan = ringkas(
    (lpResult.data ?? []).map((r) => ({
      party_kg: n(r.party_kg),
      total: n(r.total),
      pajak: n(r.pajak),
      net_tagihan: n(r.net_tagihan),
      status_entry: r.status_entry,
      payment_date: r.payment_date
    }))
  );

  const bebanRekanan = trx.reduce((s, t) => s + n(t.pendapatan), 0);
  const honorTelly = gaji.ringkas.filter((r) => !r.admin).reduce((s, r) => s + r.gaji_bersih, 0);
  const gajiAdmin = gaji.ringkas.filter((r) => r.admin).reduce((s, r) => s + r.gaji_bersih, 0);
  const pengeluaran: PosPengeluaran[] = [
    { label: 'Beban rekanan (ongkos angkut)', nilai: bebanRekanan, href: 'laporan/partner' },
    { label: 'Saku supir', nilai: kegiatan.reduce((s, k) => s + k.sangu_supir, 0), href: 'kegiatan' },
    { label: 'Terpal', nilai: kegiatan.reduce((s, k) => s + k.terpal, 0), href: 'kegiatan' },
    { label: 'Biaya operasional kegiatan', nilai: kegiatan.reduce((s, k) => s + k.operasional, 0), href: 'kegiatan' },
    { label: 'Iuran paguyuban', nilai: (pag ?? []).reduce((s, p) => s + n(p.total_bayar), 0), href: 'laporan/paguyuban' },
    { label: 'Honor telly', nilai: honorTelly, href: 'laporan/gaji' },
    { label: 'Gaji admin', nilai: gajiAdmin, href: 'laporan/gaji' },
    { label: 'Pengeluaran manual', nilai: (keluarResult.data ?? []).reduce((s, p) => s + n(p.jumlah), 0), href: 'pengeluaran' }
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

export type HasilBulan = Awaited<ReturnType<typeof hitungBulan>>;
