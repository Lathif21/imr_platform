/**
 * Fase 4b — simpan_gaji_telly dan simpan_gaji_admin (migrasi 20250116).
 *
 * Gaji admin: satu baris per bulan, bulannya di created_at (PR #5 Laravel);
 * hanya untuk jabatan admin. Honor telly: total = tonase kegiatan × gaji per
 * ton, dan tonase tidak bisa diubah dari form gaji.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { amount, closeDb, entityId, resetFixture, signIn, sql } from './helpers';

let admin: SupabaseClient;
let manager: SupabaseClient;
let iljId: string;

async function karyawan(nama: string, jabatan: string): Promise<number> {
  const [k] = await sql<{ id: number }>('insert into karyawan (entity_id, nama, jabatan) values ($1, $2, $3) returning id::int as id', [iljId, nama, jabatan]);
  return k.id;
}

const simpanAdmin = (karyawanId: number, bulan: number, total: number, pph = 0) =>
  admin.rpc('simpan_gaji_admin', {
    p_entity_id: iljId, p_karyawan_id: karyawanId, p_bulan: bulan, p_tahun: 2026,
    p_gaji_total: total, p_pph: pph, p_keterangan: null
  });

beforeAll(async () => {
  await resetFixture();
  iljId = await entityId('ILJ');
  admin = await signIn('admin.ilj');
  manager = await signIn('manajer');
});

afterAll(closeDb);

describe('simpan_gaji_admin', () => {
  it('satu baris per bulan; bulan lain menjadi baris baru, bukan menimpa', async () => {
    const id = await karyawan('Admin Satu', 'Admin Lapangan');
    expect((await simpanAdmin(id, 9, 3_000_000, 50_000)).error).toBeNull();
    expect((await simpanAdmin(id, 9, 3_500_000, 50_000)).error).toBeNull();
    expect((await simpanAdmin(id, 10, 3_100_000)).error).toBeNull();

    const rows = await sql<{ bulan: number; gaji_total: string; gaji_bersih: string; keterangan: string }>(
      `select extract(month from created_at at time zone 'Asia/Jakarta')::int as bulan, gaji_total, gaji_bersih, keterangan
         from gaji_telly where karyawan_id = $1 order by created_at`,
      [id]
    );
    expect(rows.map((r) => [r.bulan, amount(r.gaji_total), amount(r.gaji_bersih)])).toEqual([
      [9, 3_500_000, 3_450_000],
      [10, 3_100_000, 3_100_000]
    ]);
    expect(rows[0].keterangan).toBe('Gaji Admin Bulanan');
  });

  it('ditolak untuk karyawan yang bukan admin', async () => {
    const id = await karyawan('Telly Bukan Admin', 'Telly');
    const { error } = await simpanAdmin(id, 9, 1_000_000);
    expect(error?.message).toContain('berjabatan admin');
  });

  it('ditolak untuk manajer', async () => {
    const id = await karyawan('Admin Dua', 'Admin');
    const { error } = await manager.rpc('simpan_gaji_admin', {
      p_entity_id: iljId, p_karyawan_id: id, p_bulan: 9, p_tahun: 2026, p_gaji_total: 1, p_pph: 0, p_keterangan: null
    });
    expect(error).not.toBeNull();
    expect(await sql('select 1 from gaji_telly where karyawan_id = $1', [id])).toHaveLength(0);
  });
});

describe('simpan_gaji_telly', () => {
  it('total = tonase kegiatan × gaji per ton; tonase kegiatan tidak berubah', async () => {
    const telly = await karyawan('Telly Laporan', 'Telly');
    const { data: rekap } = await admin.rpc('tambah_kegiatan', {
      p_entity_id: iljId, p_nama_kapal: 'KM Gaji', p_bulan: 9, p_tahun: 2026,
      p_tanggal_input: null, p_tanggal_kegiatan: null, p_tanggal_selesai: null, p_keterangan: null
    });
    const [p] = await sql<{ id: number }>("insert into pemilik (entity_id, nama_pemilik) values ($1, 'P Gaji') returning id::int as id", [iljId]);
    await admin.rpc('simpan_rincian_kegiatan', {
      p_rekap_id: rekap, p_rute: 'Kapal/Pelabuhan', p_operasional: 0, p_telly_id: telly,
      p_tanggal_input: null, p_tanggal_kegiatan: null, p_tanggal_selesai: null, p_keterangan: null,
      p_truk: [{ nopol: 'UJI GAJI 1', pemilik_id: p.id, ritase: 1, tonase: 50 }]
    });
    const [g] = await sql<{ id: number }>('select id::int from gaji_telly where operasional_rekap_id = $1', [rekap]);

    const { error } = await admin.rpc('simpan_gaji_telly', { p_id: g.id, p_gaji: 450, p_pph: 1_000, p_keterangan: 'Voy 12' });
    expect(error).toBeNull();
    const [after] = await sql<{ gaji: string; gaji_total: string; gaji_bersih: string; keterangan: string }>('select * from gaji_telly where id = $1', [g.id]);
    expect(amount(after.gaji_total)).toBe(22_500);
    expect(amount(after.gaji_bersih)).toBe(21_500);
    expect(after.keterangan).toBe('Voy 12');

    // Disimpan ulang dari kegiatan: gaji per ton dan PPh yang diisi bertahan.
    await admin.rpc('simpan_rincian_kegiatan', {
      p_rekap_id: rekap, p_rute: 'Kapal/Pelabuhan', p_operasional: 0, p_telly_id: telly,
      p_tanggal_input: null, p_tanggal_kegiatan: null, p_tanggal_selesai: null, p_keterangan: null,
      p_truk: [{ nopol: 'UJI GAJI 1', ritase: 1, tonase: 60 }]
    });
    const [again] = await sql<{ gaji: string; gaji_total: string; pph: string }>('select * from gaji_telly where id = $1', [g.id]);
    expect(amount(again.gaji)).toBe(450);
    expect(amount(again.gaji_total)).toBe(27_000);
    expect(amount(again.pph)).toBe(1_000);
  });

  it('menolak baris gaji admin', async () => {
    const id = await karyawan('Admin Tiga', 'Admin');
    await simpanAdmin(id, 9, 1_000_000);
    const [g] = await sql<{ id: number }>('select id::int from gaji_telly where karyawan_id = $1', [id]);
    const { error } = await admin.rpc('simpan_gaji_telly', { p_id: g.id, p_gaji: 1, p_pph: 0, p_keterangan: null });
    expect(error?.message).toContain('gaji admin');
  });
});
