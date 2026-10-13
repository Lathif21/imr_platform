/**
 * Ekspor Excel = template impor yang sudah terisi data layar. Tanpa database.
 *
 * Yang dijaga: file ekspor harus bisa langsung diunggah kembali — tanggal
 * tetap tanggal (bukan bergeser sehari), angka tetap angka, dan setiap kolom
 * terbaca di kunci yang sama.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bacaBerkas, buatTemplate } from '$lib/server/impor/excel';
import { IMPOR, type BarisEkspor, type Konteks } from '$lib/server/impor/jenis';
import { rupiah, tanggal, teks } from '$lib/server/impor/sel';

/** Every query resolves to no rows: the dropdown lists are empty. */
function dbKosong(): SupabaseClient {
  const q: unknown = new Proxy(() => {}, {
    get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => void) => ok({ data: [], error: null }) : q),
    apply: () => q
  });
  return q as SupabaseClient;
}

const K: Konteks = {
  db: dbKosong(),
  entity: { id: 'e-1', code: 'ILA', legal_name: 'PT ILA' } as Konteks['entity'],
  periode: { bulan: 10, tahun: 2026 }
};

async function bolakBalik(jenis: 'pengeluaran' | 'kegiatan', isi: BarisEkspor[]) {
  const buf = await buatTemplate(jenis, IMPOR[jenis], K, isi);
  return bacaBerkas(jenis, IMPOR[jenis], buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

describe('ekspor → unggah kembali', () => {
  it('pengeluaran: tanggal, rupiah, dan teks terbaca sama persis', async () => {
    const { rows, galatBerkas } = await bolakBalik('pengeluaran', [
      { tanggal: '2026-10-01', jenis: 'Sewa Kantor', nama_kegiatan: 'Sewa Oktober', penerima: null, jumlah: 1_250_000, keterangan: null },
      { tanggal: '2026-10-31', jenis: 'BBM', nama_kegiatan: null, penerima: 'Budi', jumlah: 75_500, keterangan: 'tunai' }
    ]);
    expect(galatBerkas).toEqual([]);
    expect(rows.map((r) => r.baris)).toEqual([2, 3]);
    expect(rows.map((r) => tanggal(r.nilai.tanggal))).toEqual(['2026-10-01', '2026-10-31']);
    expect(rows.map((r) => rupiah(r.nilai.jumlah))).toEqual([1_250_000, 75_500]);
    expect(teks(rows[0].nilai.nama_kegiatan)).toBe('Sewa Oktober');
    expect(teks(rows[0].nilai.penerima)).toBe('');
    expect(teks(rows[1].nilai.keterangan)).toBe('tunai');
  });

  it('kegiatan: satu baris per truk, kolom kegiatan hanya di baris pertama', async () => {
    const { rows, galatBerkas } = await bolakBalik('kegiatan', [
      { tanggal_kegiatan: '2026-10-05', tanggal_selesai: '2026-10-07', nama_kapal: 'KM Uji', rute_asal: 'KIG', rute_tujuan: 'Pelabuhan', operasional: 300_000, telly: null, keterangan: null, nopol: 'W 1 A', pemilik: 'H. Ahmad', ritase: 2, tonase: 10.5, ongkos_angkut: 20_000, sangu_supir: 150_000, terpal: 50_000 },
      { tanggal_kegiatan: '2026-10-05', tanggal_selesai: '2026-10-07', nama_kapal: 'KM Uji', nopol: 'W 2 B', pemilik: null, ritase: 1, tonase: 8, ongkos_angkut: 0, sangu_supir: 0, terpal: 0 }
    ]);
    expect(galatBerkas).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(tanggal(rows[1].nilai.tanggal_kegiatan)).toBe('2026-10-05');
    expect(rows[0].nilai.tonase).toBe(10.5);
    expect(rupiah(rows[0].nilai.operasional)).toBe(300_000);
    expect(rupiah(rows[1].nilai.operasional)).toBeNull();
    expect(teks(rows[1].nilai.nopol)).toBe('W 2 B');
  });

  it('tanpa data, hasilnya template kosong', async () => {
    const { rows, galatBerkas } = await bolakBalik('pengeluaran', []);
    expect(rows).toEqual([]);
    expect(galatBerkas[0]).toMatch(/belum berisi baris/);
  });
});
