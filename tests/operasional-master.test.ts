/**
 * The summary views behind the master-data screens (Fase 1). Each one
 * replaces a figure Laravel computed in Eloquent, so each test pins the
 * Laravel behaviour it is standing in for.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { closeDb, entityId, resetFixture, signIn, sql, userId } from './helpers';

let admin: SupabaseClient;
let iljId: string;
let karyawanId: number;
let pemilikId: number;
let kendaraanId: number;

async function insertId(text: string, params: unknown[]): Promise<number> {
  const [row] = await sql<{ id: number }>(`${text} returning id::int as id`, params);
  return row.id;
}

beforeAll(async () => {
  await resetFixture();
  iljId = await entityId('ILJ');

  pemilikId = await insertId(
    "insert into pemilik (entity_id, nama_pemilik) values ($1, 'H. Ahmad')",
    [iljId]
  );
  kendaraanId = await insertId(
    "insert into kendaraan (entity_id, nopol, pemilik_id) values ($1, 'BP 1234 XY', $2)",
    [iljId, pemilikId]
  );
  const kapal = await insertId(
    "insert into kapal (entity_id, nama_kapal) values ($1, 'KM Uji')",
    [iljId]
  );
  // Two transactions on the owner's truck: 200.445.000,00 + 0,50. Summed in
  // numeric, the half rupiah survives; summed in float it would not.
  await sql(
    `insert into transaksi_operasional (entity_id, tanggal, kapal_id, kendaraan_id, rute, pendapatan)
     values ($1, '2026-08-01', $2, $3, 'A', 200445000.00),
            ($1, '2026-08-02', $2, $3, 'B', 0.50)`,
    [iljId, kapal, kendaraanId]
  );

  karyawanId = await insertId(
    "insert into karyawan (entity_id, nama) values ($1, 'Budi')",
    [iljId]
  );

  admin = await signIn('admin.ilj');
});

afterAll(closeDb);

/** Runs `body` with the manager's ILJ assignment revoked, then restores it. */
async function tanpaAksesIlj(body: (client: SupabaseClient) => Promise<void>) {
  const uid = await userId('manajer');
  await sql('delete from user_entity_access where user_id = $1 and entity_id = $2', [uid, iljId]);
  try {
    await body(await signIn('manajer'));
  } finally {
    await sql('insert into user_entity_access (user_id, entity_id) values ($1, $2) on conflict do nothing', [uid, iljId]);
  }
}

describe('v_pemilik_ringkasan', () => {
  it('menghitung kendaraan dan menjumlahkan pembayaran rekanan lewat kendaraannya', async () => {
    const { data, error } = await admin
      .from('v_pemilik_ringkasan')
      .select('jumlah_kendaraan, total_pendapatan_rekanan')
      .eq('id', pemilikId)
      .single();
    expect(error).toBeNull();
    expect(data?.jumlah_kendaraan).toBe(1);
    // PostgREST sends numeric as a JSON number; the half rupiah must survive.
    expect(Number(data?.total_pendapatan_rekanan)).toBe(200445000.5);
  });
});

describe('v_kendaraan_ringkasan', () => {
  it('menghitung transaksi yang memakai kendaraan', async () => {
    const { data } = await admin
      .from('v_kendaraan_ringkasan')
      .select('nama_pemilik, jumlah_transaksi, jumlah_muatan')
      .eq('id', kendaraanId)
      .single();
    expect(data).toEqual({ nama_pemilik: 'H. Ahmad', jumlah_transaksi: 2, jumlah_muatan: 0 });
  });
});

describe('v_karyawan_ringkasan.status_kinerja', () => {
  async function status(): Promise<string> {
    const { data } = await admin
      .from('v_karyawan_ringkasan')
      .select('status_kinerja')
      .eq('id', karyawanId)
      .single();
    return data?.status_kinerja;
  }

  async function catat(jenis: string, tanggal: string): Promise<number> {
    return insertId(
      'insert into karyawan_catatan (entity_id, karyawan_id, tanggal, jenis) values ($1, $2, $3, $4)',
      [iljId, karyawanId, tanggal, jenis]
    );
  }

  it('Normal selama hanya ada catatan biasa', async () => {
    await catat('catatan', '2026-01-10');
    expect(await status()).toBe('Normal');
  });

  it('SP terberat yang pernah tercatat, bukan yang terbaru', async () => {
    const sp3 = await catat('SP3', '2026-02-01');
    await catat('SP1', '2026-03-01');
    expect(await status()).toBe('SP3');

    // Laravel has no expiry on an SP: removing the SP3 is the only way down.
    await sql('delete from karyawan_catatan where id = $1', [sp3]);
    expect(await status()).toBe('SP1');
  });

  it('tidak memuat tarif gaji', async () => {
    const { error } = await admin.from('v_karyawan_ringkasan').select('tarif_telly').limit(1);
    expect(error).not.toBeNull();
  });
});

describe('RLS lewat view', () => {
  it('pengguna yang tidak ditugaskan ke entitas itu tidak melihat apa pun', async () => {
    await tanpaAksesIlj(async (tanpaIlj) => {
      for (const view of ['v_pemilik_ringkasan', 'v_kendaraan_ringkasan', 'v_karyawan_ringkasan']) {
        const { data, error } = await tanpaIlj.from(view).select('id');
        expect(error, view).toBeNull();
        expect(data, view).toEqual([]);
      }
    });
  });
});
