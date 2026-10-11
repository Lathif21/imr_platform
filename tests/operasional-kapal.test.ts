/**
 * Fase 1b — hapus_kapal() (migrasi 20250112).
 *
 * Laravel menghapus kapal beserta seluruh kegiatannya dalam satu transaksi.
 * Dua hal di skema ini tidak ikut lewat cascade dengan benar, dan keduanya
 * yang dijaga di sini:
 *
 *   - honor telly per kegiatan (gaji_telly.operasional_rekap_id, SET NULL)
 *     yang tanpa langkah eksplisit akan tersisa sebagai baris tanpa induk —
 *     terbaca sebagai gaji admin;
 *   - pencairan (CASCADE) yang akan ikut terhapus diam-diam.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { closeDb, entityId, resetFixture, signIn, sql } from './helpers';

let admin: SupabaseClient;
let manager: SupabaseClient;
let iljId: string;

async function insertId(text: string, params: unknown[]): Promise<number> {
  const [row] = await sql<{ id: number }>(`${text} returning id::int as id`, params);
  return row.id;
}

/** Kapal dengan satu kegiatan, satu truk, dan honor telly per kegiatan. */
async function kapalLengkap(nama: string) {
  const kapal = await insertId('insert into kapal (entity_id, nama_kapal) values ($1, $2)', [iljId, nama]);
  const rekap = await insertId(
    "insert into operasional_rekap (entity_id, bulan, tahun, kapal_id, rute) values ($1, 9, 2026, $2, 'Gudang - Kapal')",
    [iljId, kapal]
  );
  const pemilik = await insertId("insert into pemilik (entity_id, nama_pemilik) values ($1, $2)", [iljId, `P ${nama}`]);
  const kendaraan = await insertId(
    'insert into kendaraan (entity_id, nopol, pemilik_id) values ($1, $2, $3)',
    [iljId, `UJI ${kapal}`, pemilik]
  );
  await sql(
    `insert into transaksi_operasional (entity_id, tanggal, kapal_id, kendaraan_id, operasional_rekap_id, rute, tonase)
     values ($1, '2026-09-10', $2, $3, $4, 'Gudang - Kapal', 10)`,
    [iljId, kapal, kendaraan, rekap]
  );
  const telly = await insertId("insert into karyawan (entity_id, nama, jabatan) values ($1, $2, 'Telly')", [iljId, `Telly ${nama}`]);
  const gaji = await insertId(
    'insert into gaji_telly (entity_id, karyawan_id, operasional_rekap_id, gaji, gaji_total, gaji_bersih) values ($1, $2, $3, 400, 4000, 4000)',
    [iljId, telly, rekap]
  );
  return { kapal, rekap, gaji, telly };
}

async function count(table: string, where: string, params: unknown[]): Promise<number> {
  const [row] = await sql<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`, params);
  return row.n;
}

beforeAll(async () => {
  await resetFixture();
  iljId = await entityId('ILJ');
  admin = await signIn('admin.ilj');
  manager = await signIn('manajer');
});

afterAll(closeDb);

describe('hapus_kapal', () => {
  it('menghapus kapal beserta kegiatan, truk, dan honor telly per kegiatannya', async () => {
    const k = await kapalLengkap('KM Hapus');

    const { error } = await admin.rpc('hapus_kapal', { p_kapal_id: k.kapal });
    expect(error).toBeNull();

    expect(await count('kapal', 'id = $1', [k.kapal])).toBe(0);
    expect(await count('operasional_rekap', 'id = $1', [k.rekap])).toBe(0);
    expect(await count('transaksi_operasional', 'kapal_id = $1', [k.kapal])).toBe(0);
    // Inti tes: tanpa langkah eksplisit, baris ini tersisa dengan
    // operasional_rekap_id NULL dan terbaca sebagai gaji admin.
    expect(await count('gaji_telly', 'id = $1', [k.gaji])).toBe(0);
    expect(
      await count('gaji_telly', 'karyawan_id = $1 and transaksi_id is null and operasional_rekap_id is null', [k.telly])
    ).toBe(0);
  });

  it('menolak kapal yang punya pencairan, tanpa menghapus apa pun', async () => {
    const k = await kapalLengkap('KM Pencairan');
    await sql(
      "insert into pencairan (entity_id, kapal_id, bulan, nomor_invoice, nominal_invoice) values ($1, $2, 9, 'INV-UJI-1', 1000000)",
      [iljId, k.kapal]
    );

    const { error } = await admin.rpc('hapus_kapal', { p_kapal_id: k.kapal });
    expect(error?.code).toBe('P0001');
    expect(error?.message).toContain('pencairan');

    expect(await count('kapal', 'id = $1', [k.kapal])).toBe(1);
    expect(await count('gaji_telly', 'id = $1', [k.gaji])).toBe(1);
    expect(await count('pencairan', 'kapal_id = $1', [k.kapal])).toBe(1);
  });

  /** Manajer boleh membaca data operasional, tidak boleh menghapusnya. */
  it('menolak peran yang tidak menulis data operasional, tanpa menghapus apa pun', async () => {
    const k = await kapalLengkap('KM Manajer');

    const { error } = await manager.rpc('hapus_kapal', { p_kapal_id: k.kapal });
    expect(error).not.toBeNull();

    expect(await count('kapal', 'id = $1', [k.kapal])).toBe(1);
    expect(await count('gaji_telly', 'id = $1', [k.gaji])).toBe(1);
  });

  it('tercatat di audit_log, termasuk baris yang ikut terhapus', async () => {
    const k = await kapalLengkap('KM Audit');
    await admin.rpc('hapus_kapal', { p_kapal_id: k.kapal });

    const rows = await sql<{ table_name: string }>(
      `select distinct table_name from audit_log
        where action = 'DELETE' and record_pk in ($1, $2, $3)`,
      [String(k.kapal), String(k.rekap), String(k.gaji)]
    );
    const tables = rows.map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining(['kapal', 'operasional_rekap', 'gaji_telly']));
  });
});
