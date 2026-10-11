/**
 * Laporan Gaji Karyawan — LaporanController::telly, read-only here.
 *
 * Laravel's telly() wrote on every visit: it re-created honor rows for each
 * kegiatan and overwrote kegiatan tonase. hitung_ulang_kegiatan()
 * (migration 20250113) already keeps those rows current whenever a kegiatan
 * is saved, so the report only reads.
 *
 * Figures as Laravel: honor kotor = tonase kegiatan × gaji per ton (400 if
 * unset); bersih = kotor − PPh, minimum 0. An employee whose jabatan contains
 * "admin" is paid by the month: one row with no kegiatan, its month taken
 * from created_at (Jakarta time).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rentangBulan, type Periode } from '$lib/operasional/kegiatan';
import { failLoad } from './operasional';

export interface BarisHonor {
  id: number;
  kegiatan: string;
  rute: string | null;
  tonase: number;
  ritase: number;
  gaji: number;
  gaji_total: number;
  pph: number;
  gaji_bersih: number;
  keterangan: string | null;
}

export interface BarisAdmin {
  id: number | null;
  gaji_total: number;
  pph: number;
  gaji_bersih: number;
  keterangan: string | null;
}

export interface RingkasKaryawan {
  id: number;
  nama: string;
  jabatan: string | null;
  ktp: string | null;
  npwp: string | null;
  admin: boolean;
  aktivitas: number;
  tonase: number;
  gaji_kotor: number;
  pph: number;
  gaji_bersih: number;
}

export const isAdmin = (jabatan: string | null) => (jabatan ?? '').toLowerCase().includes('admin');

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function muatGaji(db: SupabaseClient, entityId: string, periode: Periode) {
  const { dari, sampai } = rentangBulan(periode);
  const [karyawanResult, rekapResult, adminResult] = await Promise.all([
    db
      .from('karyawan')
      .select('id, nama, jabatan, ktp, npwp, status')
      .eq('entity_id', entityId)
      .order('nama')
      .returns<{ id: number; nama: string; jabatan: string | null; ktp: string | null; npwp: string | null; status: string }[]>(),
    db
      .from('operasional_rekap')
      .select('id, kapal_id, rute, tonase, trips, telly_id, keterangan')
      .eq('entity_id', entityId)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .not('telly_id', 'is', null)
      .returns<{ id: number; kapal_id: number; rute: string | null; tonase: string; trips: number | null; telly_id: number; keterangan: string | null }[]>(),
    db
      .from('gaji_telly')
      .select('id, karyawan_id, gaji_total, pph, gaji_bersih, keterangan')
      .eq('entity_id', entityId)
      .is('operasional_rekap_id', null)
      .is('transaksi_id', null)
      .gte('created_at', new Date(Date.parse(`${dari}T00:00:00+07:00`)).toISOString())
      .lt('created_at', new Date(Date.parse(`${sampai}T00:00:00+07:00`)).toISOString())
      .order('id')
      .returns<{ id: number; karyawan_id: number; gaji_total: string; pph: string; gaji_bersih: string; keterangan: string | null }[]>()
  ]);
  if (karyawanResult.error) failLoad('gaji karyawan', karyawanResult.error);
  if (rekapResult.error) failLoad('gaji rekap', rekapResult.error);
  if (adminResult.error) failLoad('gaji admin', adminResult.error);

  const rekaps = rekapResult.data ?? [];
  const [kapalResult, honorResult] = await Promise.all([
    db.from('kapal').select('id, nama_kapal').in('id', [...new Set(rekaps.map((r) => r.kapal_id))]).returns<{ id: number; nama_kapal: string }[]>(),
    db
      .from('gaji_telly')
      .select('id, karyawan_id, operasional_rekap_id, gaji, pph, keterangan')
      .in('operasional_rekap_id', rekaps.map((r) => r.id))
      .returns<{ id: number; karyawan_id: number; operasional_rekap_id: number; gaji: string; pph: string; keterangan: string | null }[]>()
  ]);
  if (kapalResult.error) failLoad('gaji kapal', kapalResult.error);
  if (honorResult.error) failLoad('gaji honor', honorResult.error);

  const namaKapal = new Map((kapalResult.data ?? []).map((k) => [k.id, k.nama_kapal]));
  const rekapById = new Map(rekaps.map((r) => [r.id, r]));

  /** Honor rows per telly, only for kegiatan this telly is still assigned to. */
  const honor = new Map<number, BarisHonor[]>();
  for (const g of honorResult.data ?? []) {
    const r = rekapById.get(g.operasional_rekap_id);
    if (!r || r.telly_id !== g.karyawan_id) continue;
    const tonase = n(r.tonase);
    const gaji = n(g.gaji) > 0 ? n(g.gaji) : 400;
    const kotor = tonase * gaji;
    const pph = n(g.pph);
    const ket = g.keterangan || r.keterangan || '';
    let kegiatan = namaKapal.get(r.kapal_id) ?? 'KM. BONGKARAN';
    if (ket.toLowerCase().includes('voy')) kegiatan += ` ${ket}`;
    honor.set(g.karyawan_id, [
      ...(honor.get(g.karyawan_id) ?? []),
      { id: g.id, kegiatan, rute: r.rute, tonase, ritase: r.trips ?? 1, gaji, gaji_total: kotor, pph, gaji_bersih: Math.max(0, kotor - pph), keterangan: ket || null }
    ]);
  }

  const admin = new Map<number, BarisAdmin>();
  for (const a of adminResult.data ?? []) {
    if (admin.has(a.karyawan_id)) continue; // one row per month; the first if a migration left two
    admin.set(a.karyawan_id, { id: a.id, gaji_total: n(a.gaji_total), pph: n(a.pph), gaji_bersih: n(a.gaji_bersih), keterangan: a.keterangan });
  }

  const karyawan = karyawanResult.data ?? [];
  const ringkas: RingkasKaryawan[] = karyawan
    .map((k) => {
      const base = { id: k.id, nama: k.nama, jabatan: k.jabatan, ktp: k.ktp, npwp: k.npwp, admin: isAdmin(k.jabatan) };
      if (base.admin) {
        const a = admin.get(k.id);
        return { ...base, aktivitas: a ? 1 : 0, tonase: 0, gaji_kotor: a?.gaji_total ?? 0, pph: a?.pph ?? 0, gaji_bersih: a?.gaji_bersih ?? 0 };
      }
      const rows = honor.get(k.id) ?? [];
      const kotor = rows.reduce((s, r) => s + r.gaji_total, 0);
      const pph = rows.reduce((s, r) => s + r.pph, 0);
      return {
        ...base,
        aktivitas: rows.length,
        tonase: rows.reduce((s, r) => s + r.tonase, 0),
        gaji_kotor: kotor,
        pph,
        gaji_bersih: Math.max(0, kotor - pph)
      };
    })
    .filter((r) => r.aktivitas > 0 || r.gaji_kotor > 0);

  return { karyawan, ringkas, honor, admin };
}
