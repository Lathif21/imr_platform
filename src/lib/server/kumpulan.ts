/**
 * Data for Kumpulan Laporan, shared by the screen and the printout.
 *
 * A month either has a saved version (laporan_kumpulan: the cards and the
 * expense lines as the admin edited them) or is computed fresh from the
 * operational tables. Laravel deleted the saved version whenever any
 * kegiatan of the month was saved, silently discarding the admin's edits;
 * here it stays until "Reset" is pressed, and the screen says it is a saved
 * version and when it was saved.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rentangBulan, type Periode } from '$lib/operasional/kegiatan';
import { susunKumpulan, type KartuKapal, type Pengeluaran } from '$lib/operasional/kumpulan';
import { failLoad } from './operasional';

export interface DataKumpulan {
  cards: KartuKapal[];
  pengeluaran: Pengeluaran;
  notes: string;
  /** ISO timestamp of the saved version, or null when computed fresh. */
  disimpan: string | null;
  /** Paid invoices with no linked kegiatan: their costs read as 0. */
  tanpaKegiatan: string[];
}

const angka = (v: unknown) => Number(v ?? 0) || 0;

export async function muatKumpulan(db: SupabaseClient, entityId: string, periode: Periode): Promise<DataKumpulan> {
  const { data: saved, error: savedError } = await db
    .from('laporan_kumpulan')
    .select('cards_json, summary_json, notes, updated_at')
    .eq('entity_id', entityId)
    .eq('bulan', periode.bulan)
    .eq('tahun', periode.tahun)
    .maybeSingle<{ cards_json: unknown; summary_json: Record<string, unknown> | null; notes: string | null; updated_at: string }>();
  if (savedError) failLoad('laporan_kumpulan', savedError);

  if (saved && Array.isArray(saved.cards_json)) {
    const s = saved.summary_json ?? {};
    return {
      cards: (saved.cards_json as Record<string, unknown>[]).map((c) => ({
        kegiatan: String(c.kegiatan ?? ''),
        telly: String(c.telly ?? ''),
        muatan_mt: angka(c.muatan_mt),
        ritase: angka(c.ritase),
        tagihan: angka(c.tagihan),
        pajak: angka(c.pajak),
        rekanan: angka(c.rekanan),
        ongkos_pbm: angka(c.ongkos_pbm),
        terpal_50: angka(c.terpal_50),
        operasional: angka(c.operasional)
      })),
      pengeluaran: {
        gaji_karyawan: angka(s.gaji_karyawan),
        sewa_kantor: angka(s.sewa_kantor),
        pph_sewa_kantor: angka(s.pph_sewa_kantor),
        atensi_jalan: angka(s.atensi_jalan),
        beban_kantor: angka(s.beban_kantor)
      },
      notes: saved.notes ?? '',
      disimpan: saved.updated_at,
      tanpaKegiatan: []
    };
  }

  const { dari, sampai } = rentangBulan(periode);

  const [lpResult, rekapResult, karyawanResult, pengeluaranResult, adminResult] = await Promise.all([
    db
      .from('laporan_pendapatan')
      .select('operasional_rekap_id, kegiatan, party_kg, total, pajak, status_entry, payment_date')
      .eq('entity_id', entityId)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .order('no_urut', { ascending: true, nullsFirst: false })
      .order('id')
      .returns<Record<string, string | number | null>[]>(),
    db
      .from('operasional_rekap')
      .select('id, trips, sangu_supir, terpal, operasional, telly_id')
      .eq('entity_id', entityId)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .returns<Record<string, string | number | null>[]>(),
    db.from('karyawan').select('id, nama').eq('entity_id', entityId).returns<{ id: number; nama: string }[]>(),
    db
      .from('pengeluaran')
      .select('jenis, jumlah')
      .eq('entity_id', entityId)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .returns<{ jenis: string; jumlah: string }[]>(),
    // Gaji admin: rows with no kegiatan, month from created_at in Jakarta
    // time (simpan_gaji_admin, migration 20250116).
    db
      .from('gaji_telly')
      .select('gaji_bersih, created_at')
      .eq('entity_id', entityId)
      .is('operasional_rekap_id', null)
      .gte('created_at', new Date(Date.parse(`${dari}T00:00:00+07:00`)).toISOString())
      .lt('created_at', new Date(Date.parse(`${sampai}T00:00:00+07:00`)).toISOString())
      .returns<{ gaji_bersih: string; created_at: string }[]>()
  ]);
  if (lpResult.error) failLoad('kumpulan pendapatan', lpResult.error);
  if (rekapResult.error) failLoad('kumpulan rekap', rekapResult.error);
  if (karyawanResult.error) failLoad('kumpulan karyawan', karyawanResult.error);
  if (pengeluaranResult.error) failLoad('kumpulan pengeluaran', pengeluaranResult.error);
  if (adminResult.error) failLoad('kumpulan gaji admin', adminResult.error);

  const rekapIds = (rekapResult.data ?? []).map((r) => Number(r.id));
  const { data: tellyRows, error: tellyError } = await db
    .from('gaji_telly')
    .select('gaji_bersih')
    .in('operasional_rekap_id', rekapIds)
    .returns<{ gaji_bersih: string }[]>();
  if (tellyError) failLoad('kumpulan gaji telly', tellyError);

  const nama = new Map((karyawanResult.data ?? []).map((k) => [k.id, k.nama]));
  const kegiatan = new Map(
    (rekapResult.data ?? []).map((r) => [
      Number(r.id),
      {
        trips: angka(r.trips),
        sangu_supir: angka(r.sangu_supir),
        terpal: angka(r.terpal),
        operasional: angka(r.operasional),
        telly: r.telly_id === null ? null : (nama.get(Number(r.telly_id)) ?? null)
      }
    ])
  );

  const hasil = susunKumpulan({
    pendapatan: (lpResult.data ?? []).map((l) => ({
      operasional_rekap_id: l.operasional_rekap_id === null ? null : Number(l.operasional_rekap_id),
      kegiatan: String(l.kegiatan ?? ''),
      party_kg: angka(l.party_kg),
      total: angka(l.total),
      pajak: angka(l.pajak),
      status_entry: (l.status_entry as string | null) ?? null,
      payment_date: (l.payment_date as string | null) ?? null
    })),
    kegiatan,
    gajiTelly: (tellyRows ?? []).reduce((n, g) => n + angka(g.gaji_bersih), 0),
    gajiAdmin: (adminResult.data ?? []).reduce((n, g) => n + angka(g.gaji_bersih), 0),
    pengeluaran: (pengeluaranResult.data ?? []).map((p) => ({ jenis: p.jenis, jumlah: angka(p.jumlah) }))
  });

  return { ...hasil, notes: '', disimpan: null };
}
