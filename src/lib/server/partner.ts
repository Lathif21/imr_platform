/**
 * Laporan Partner — LaporanController::partner. What is paid to each truck
 * owner in a month: beban rekanan (transaksi.pendapatan = tonase × ongkos
 * angkut), minus saku supir and terpal, as Laravel's "laba bersih".
 *
 * The column names stay as the partner sees them ("Pendapatan Bruto") — it
 * is the partner's income and this company's cost (10-integrasi-
 * operasional.md). Activity dates come from the kegiatan the truck belongs
 * to; Laravel looked the kegiatan up by (kapal, rute).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rentangBulan, type Periode } from '$lib/operasional/kegiatan';
import { failLoad } from './operasional';

export interface BarisPartner {
  tanggal_kegiatan: string | null;
  tanggal_selesai: string | null;
  nopol: string;
  kapal: string;
  rute: string;
  ritase: number;
  tonase: number;
  ongkos_angkut: number;
  pendapatan: number;
  sangu_supir: number;
  terpal: number;
  bersih: number;
}

export interface RingkasPartner {
  id: number;
  nama: string;
  kendaraan: number;
  transaksi: number;
  pendapatan: number;
  biaya: number;
  bersih: number;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function muatPartner(db: SupabaseClient, entityId: string, periode: Periode) {
  const { dari, sampai } = rentangBulan(periode);
  const [pemilikResult, kendaraanResult, trxResult, rekapResult, kapalResult] = await Promise.all([
    db.from('pemilik').select('id, nama_pemilik').eq('entity_id', entityId).order('nama_pemilik').returns<{ id: number; nama_pemilik: string }[]>(),
    db.from('kendaraan').select('id, nopol, pemilik_id').eq('entity_id', entityId).returns<{ id: number; nopol: string; pemilik_id: number }[]>(),
    db
      .from('transaksi_operasional')
      .select('kendaraan_id, kapal_id, operasional_rekap_id, rute, tanggal, tanggal_kegiatan, tanggal_selesai, ritase, tonase, ongkos_angkut, pendapatan, sangu_supir, terpal')
      .eq('entity_id', entityId)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .order('kapal_id')
      .order('tanggal')
      .returns<Record<string, string | number | null>[]>(),
    db
      .from('operasional_rekap')
      .select('id, tanggal_kegiatan, tanggal_selesai')
      .eq('entity_id', entityId)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .returns<{ id: number; tanggal_kegiatan: string | null; tanggal_selesai: string | null }[]>(),
    db.from('kapal').select('id, nama_kapal').eq('entity_id', entityId).returns<{ id: number; nama_kapal: string }[]>()
  ]);
  for (const [k, r] of Object.entries({ pemilikResult, kendaraanResult, trxResult, rekapResult, kapalResult })) {
    if (r.error) failLoad(`partner ${k}`, r.error);
  }

  const kendaraan = new Map((kendaraanResult.data ?? []).map((k) => [k.id, k]));
  const kapal = new Map((kapalResult.data ?? []).map((k) => [k.id, k.nama_kapal]));
  const rekap = new Map((rekapResult.data ?? []).map((r) => [r.id, r]));

  const perPemilik = new Map<number, BarisPartner[]>();
  for (const t of trxResult.data ?? []) {
    const k = kendaraan.get(Number(t.kendaraan_id));
    if (!k) continue;
    const r = t.operasional_rekap_id === null ? undefined : rekap.get(Number(t.operasional_rekap_id));
    const pendapatan = n(t.pendapatan);
    const sangu = n(t.sangu_supir);
    const terpal = n(t.terpal);
    perPemilik.set(k.pemilik_id, [
      ...(perPemilik.get(k.pemilik_id) ?? []),
      {
        tanggal_kegiatan: (t.tanggal_kegiatan as string | null) ?? r?.tanggal_kegiatan ?? (t.tanggal as string),
        tanggal_selesai: (t.tanggal_selesai as string | null) ?? r?.tanggal_selesai ?? null,
        nopol: k.nopol,
        kapal: kapal.get(Number(t.kapal_id)) ?? '—',
        rute: String(t.rute ?? '-'),
        ritase: n(t.ritase),
        tonase: n(t.tonase),
        ongkos_angkut: n(t.ongkos_angkut),
        pendapatan,
        sangu_supir: sangu,
        terpal,
        bersih: pendapatan - sangu - terpal
      }
    ]);
  }

  const jumlahKendaraan = new Map<number, number>();
  for (const k of kendaraanResult.data ?? []) jumlahKendaraan.set(k.pemilik_id, (jumlahKendaraan.get(k.pemilik_id) ?? 0) + 1);

  const ringkas: RingkasPartner[] = (pemilikResult.data ?? []).map((p) => {
    const rows = perPemilik.get(p.id) ?? [];
    const pendapatan = rows.reduce((s, r) => s + r.pendapatan, 0);
    const biaya = rows.reduce((s, r) => s + r.sangu_supir + r.terpal, 0);
    return { id: p.id, nama: p.nama_pemilik, kendaraan: jumlahKendaraan.get(p.id) ?? 0, transaksi: rows.length, pendapatan, biaya, bersih: pendapatan - biaya };
  });

  return { ringkas, perPemilik };
}

export function jumlahPartner(rows: BarisPartner[]) {
  return rows.reduce(
    (a, r) => ({
      ritase: a.ritase + r.ritase,
      tonase: a.tonase + r.tonase,
      pendapatan: a.pendapatan + r.pendapatan,
      sangu_supir: a.sangu_supir + r.sangu_supir,
      terpal: a.terpal + r.terpal,
      bersih: a.bersih + r.bersih
    }),
    { ritase: 0, tonase: 0, pendapatan: 0, sangu_supir: 0, terpal: 0, bersih: 0 }
  );
}
