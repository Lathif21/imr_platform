/**
 * hitungBanyak() reads every entity and month in one batch and cuts the rows
 * per entity and month itself. Two ways that goes wrong, both checked against
 * the real database:
 *
 *   - a row lands in the wrong entity or month: the batch must equal the
 *     same figures computed one entity-month at a time;
 *   - the batch drifts from the screens: its kegiatan and gaji parts must
 *     equal what muatDetailKegiatan and muatGaji — the Detail Kegiatan and
 *     Laporan Gaji screens — return on their own.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Periode } from '$lib/operasional/kegiatan';
import { muatDetailKegiatan } from '$lib/server/detail-kegiatan';
import { muatGaji } from '$lib/server/gaji';
import { hitungBanyak, hitungBulan, kunciHasil } from '$lib/server/ringkasan-operasional';
import { closeDb, entityId, resetFixture, signIn, sql, userId } from './helpers';

let admin: SupabaseClient;
let direksi: SupabaseClient;
let iljId: string;
let amdkId: string;

const SEP: Periode = { bulan: 9, tahun: 2026 };
const OKT: Periode = { bulan: 10, tahun: 2026 };

async function insertId(text: string, params: unknown[]): Promise<number> {
  const [row] = await sql<{ id: number }>(`${text} returning id::int as id`, params);
  return row.id;
}

/** A kegiatan with trucks and a telly, through the same RPCs the screens use. */
async function kegiatan(entity: string, p: Periode, nama: string, tonase: number, telly: number) {
  const tgl = `${p.tahun}-${String(p.bulan).padStart(2, '0')}-05`;
  const { data, error } = await admin.rpc('tambah_kegiatan', {
    p_entity_id: entity, p_nama_kapal: nama, p_bulan: p.bulan, p_tahun: p.tahun,
    p_tanggal_input: null, p_tanggal_kegiatan: tgl, p_tanggal_selesai: tgl, p_keterangan: null
  });
  expect(error).toBeNull();
  const pemilik = await insertId('insert into pemilik (entity_id, nama_pemilik) values ($1, $2)', [entity, `P ${nama}`]);
  const { error: e2 } = await admin.rpc('simpan_rincian_kegiatan', {
    p_rekap_id: data, p_rute: 'Gudang - Pelabuhan', p_operasional: 250_000, p_telly_id: telly,
    p_tanggal_input: null, p_tanggal_kegiatan: tgl, p_tanggal_selesai: tgl, p_keterangan: null,
    p_truk: [
      { nopol: `A ${nama}`, pemilik_id: pemilik, ritase: 2, tonase },
      { nopol: `B ${nama}`, pemilik_id: pemilik, ritase: 1, tonase: tonase / 2 }
    ]
  });
  expect(e2).toBeNull();
}

beforeAll(async () => {
  await resetFixture();
  iljId = await entityId('ILJ');
  amdkId = await entityId('AMDK');
  // admin.ilj also inputs for AMDK here, so one account builds both entities.
  await sql('insert into user_entity_access (user_id, entity_id) values ($1, $2)', [await userId('admin.ilj'), amdkId]);
  admin = await signIn('admin.ilj');
  direksi = await signIn('direksi');

  for (const [entity, kode] of [[iljId, 'ILJ'], [amdkId, 'AMDK']] as const) {
    const telly = await insertId("insert into karyawan (entity_id, nama, jabatan) values ($1, $2, 'Telly')", [entity, `Telly ${kode}`]);
    const adm = await insertId("insert into karyawan (entity_id, nama, jabatan) values ($1, $2, 'Admin Lapangan')", [entity, `Admin ${kode}`]);
    await kegiatan(entity, SEP, `KM ${kode} Sep`, 12, telly);
    await kegiatan(entity, OKT, `KM ${kode} Okt Satu`, 20, telly);
    await kegiatan(entity, OKT, `KM ${kode} Okt Dua`, kode === 'ILJ' ? 7 : 3, telly);
    for (const p of [SEP, OKT]) {
      const { error } = await admin.rpc('simpan_gaji_admin', {
        p_entity_id: entity, p_karyawan_id: adm, p_bulan: p.bulan, p_tahun: p.tahun,
        p_gaji_total: kode === 'ILJ' ? 3_000_000 : 2_000_000, p_pph: 100_000, p_keterangan: null
      });
      expect(error).toBeNull();
      await sql('insert into pengeluaran (entity_id, tanggal, jenis, jumlah) values ($1, $2, $3, $4)', [
        entity, `${p.tahun}-${String(p.bulan).padStart(2, '0')}-20`, 'Listrik', kode === 'ILJ' ? 500_000 : 300_000
      ]);
    }
  }
});

afterAll(closeDb);

describe('hitungBanyak', () => {
  it('sama dengan menghitung satu entitas-bulan sekali waktu', async () => {
    const batch = await hitungBanyak(direksi, [iljId, amdkId], [SEP, OKT]);
    for (const e of [iljId, amdkId]) {
      for (const p of [SEP, OKT]) {
        const satu = await hitungBulan(direksi, e, p);
        const dariBatch = batch.get(kunciHasil(e, p))!;
        expect(dariBatch.labaBersih, `${e} ${p.bulan}`).toBe(satu.labaBersih);
        expect(dariBatch.pengeluaran).toEqual(satu.pengeluaran);
        expect(dariBatch.pendapatan).toEqual(satu.pendapatan);
        expect(dariBatch.volume).toEqual(satu.volume);
      }
    }
  });

  it('tidak mencampur entitas atau bulan', async () => {
    const batch = await hitungBanyak(direksi, [iljId, amdkId], [SEP, OKT]);
    expect(batch.get(kunciHasil(iljId, SEP))!.volume.kegiatan).toBe(1);
    expect(batch.get(kunciHasil(iljId, OKT))!.volume.kegiatan).toBe(2);
    expect(batch.get(kunciHasil(amdkId, OKT))!.volume.tonase).toBe(20 + 10 + 3 + 1.5);
    const manual = (e: string, p: Periode) =>
      batch.get(kunciHasil(e, p))!.pengeluaran.find((x) => x.label === 'Pengeluaran manual')!.nilai;
    expect(manual(iljId, SEP)).toBe(500_000);
    expect(manual(amdkId, OKT)).toBe(300_000);
  });

  it('rincian kegiatan dan gaji sama dengan yang dimuat layarnya sendiri', async () => {
    const batch = await hitungBanyak(direksi, [iljId, amdkId], [SEP, OKT]);
    for (const e of [iljId, amdkId]) {
      for (const p of [SEP, OKT]) {
        const b = batch.get(kunciHasil(e, p))!;
        expect(b.kegiatan).toEqual(await muatDetailKegiatan(direksi, e, p));
        const gaji = await muatGaji(direksi, e, p);
        expect(b.gaji.ringkas).toEqual(gaji.ringkas);
        // The figures this exists for are not all zero.
        expect(gaji.ringkas.some((r) => r.gaji_bersih > 0)).toBe(true);
      }
    }
  });

  it('bulan tanpa input hadir dengan nol', async () => {
    const kosong = await hitungBanyak(direksi, [iljId], [{ bulan: 3, tahun: 2025 }]);
    const h = kosong.get(kunciHasil(iljId, { bulan: 3, tahun: 2025 }))!;
    expect(h.labaBersih).toBe(0);
    expect(h.volume.kegiatan).toBe(0);
  });
});
