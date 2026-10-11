/**
 * Laporan Catatan Karyawan — LaporanController::karyawan / karyawanCetak.
 * Status kinerja comes from v_karyawan_ringkasan (heaviest SP ever
 * recorded, as Laravel's accessor). Filters: status, kinerja, and a search
 * on name or jabatan.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { failLoad } from './operasional';

export interface Filter {
  status: string;
  sp: string;
  cari: string;
}

export interface BarisKaryawan {
  id: number;
  nama: string;
  jabatan: string | null;
  status: string;
  status_kinerja: string;
  tanggal_bergabung: string | null;
  catatan: { tanggal: string; jenis: string; keterangan: string | null }[];
}

export function filterDari(url: URL): Filter {
  return {
    status: url.searchParams.get('status') ?? 'all',
    sp: url.searchParams.get('sp') ?? 'all',
    cari: (url.searchParams.get('cari') ?? '').trim()
  };
}

export async function muatLaporanKaryawan(db: SupabaseClient, entityId: string, f: Filter): Promise<BarisKaryawan[]> {
  let query = db
    .from('v_karyawan_ringkasan')
    .select('id, nama, jabatan, status, status_kinerja, tanggal_bergabung')
    .eq('entity_id', entityId)
    .order('nama');
  if (f.status === 'aktif' || f.status === 'nonaktif') query = query.eq('status', f.status);
  if (['Normal', 'SP1', 'SP2', 'SP3'].includes(f.sp)) query = query.eq('status_kinerja', f.sp);

  const [{ data, error }, catatanResult] = await Promise.all([
    query.returns<Omit<BarisKaryawan, 'catatan'>[]>(),
    db
      .from('karyawan_catatan')
      .select('karyawan_id, tanggal, jenis, keterangan')
      .eq('entity_id', entityId)
      .order('tanggal', { ascending: false })
      .returns<{ karyawan_id: number; tanggal: string; jenis: string; keterangan: string | null }[]>()
  ]);
  if (error) failLoad('laporan karyawan', error);
  if (catatanResult.error) failLoad('laporan karyawan catatan', catatanResult.error);

  const cari = f.cari.toLowerCase();
  return (data ?? [])
    .filter((k) => cari === '' || k.nama.toLowerCase().includes(cari) || (k.jabatan ?? '').toLowerCase().includes(cari))
    .map((k) => ({
      ...k,
      catatan: (catatanResult.data ?? [])
        .filter((c) => c.karyawan_id === k.id)
        .map(({ tanggal, jenis, keterangan }) => ({ tanggal, jenis, keterangan }))
    }));
}
