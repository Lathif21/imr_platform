/**
 * Fase 3 — pencairan (migrasi 20250114).
 *
 * Alur Laravel yang dijaga: invoice baru membawa tiga persetujuan Pending
 * dan satu baris Laporan Pendapatan PENDING; ketiganya menyetujui →
 * Approved dan PROSES PAYMENT; satu menolak → Rejected. Ditambah
 * perbaikannya: tahun ikut invoice, pendapatan LUNAS tidak disentuh, dan
 * hapus hanya menghapus pendapatan yang belum dibayar.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { amount, closeDb, entityId, resetFixture, signIn, sql } from './helpers';

let admin: SupabaseClient;
let manager: SupabaseClient;
let iljId: string;
let kapalId: number;

async function buat(nomor: string, extra: Partial<{ bulan: number; tahun: number; nominal: number; pajak: number }> = {}) {
  const { data, error } = await admin.rpc('simpan_pencairan', {
    p_entity_id: iljId,
    p_id: null,
    p_kapal_id: kapalId,
    p_bulan: extra.bulan ?? 12,
    p_tahun: extra.tahun ?? 2026,
    p_nomor: nomor,
    p_nominal: extra.nominal ?? 10_000_000,
    p_pajak: extra.pajak ?? 50_000
  });
  expect(error).toBeNull();
  return data as number;
}

const setujui = (id: number, departemen: string, status: string) =>
  admin.rpc('setujui_pencairan', {
    p_pencairan_id: id,
    p_departemen: departemen,
    p_status: status,
    p_tanggal_ttd: null,
    p_keterangan: null
  });

async function pendapatan(nomor: string) {
  return sql<{ bulan: number; tahun: number; total: string; pajak: string; net_tagihan: string; status_entry: string; kegiatan: string; no_urut: number }>(
    'select bulan, tahun, total, pajak, net_tagihan, status_entry, kegiatan, no_urut from laporan_pendapatan where no_invoice = $1',
    [nomor]
  );
}

async function status(id: number) {
  const [row] = await sql<{ status: string }>('select status from pencairan where id = $1', [id]);
  return row.status;
}

beforeAll(async () => {
  await resetFixture();
  iljId = await entityId('ILJ');
  admin = await signIn('admin.ilj');
  manager = await signIn('manajer');
  const [k] = await sql<{ id: number }>(
    "insert into kapal (entity_id, nama_kapal) values ($1, 'KM Invoice') returning id::int as id",
    [iljId]
  );
  kapalId = k.id;
});

afterAll(closeDb);

describe('simpan_pencairan', () => {
  it('invoice baru: tiga persetujuan Pending dan pendapatan PENDING pada bulan dan tahun invoice', async () => {
    const id = await buat('INV-F3-1');
    const approvals = await sql<{ departemen: string; status: string }>(
      'select departemen, status from pencairan_approval where pencairan_id = $1 order by departemen',
      [id]
    );
    expect(approvals).toEqual([
      { departemen: 'Accounting', status: 'Pending' },
      { departemen: 'Gudang', status: 'Pending' },
      { departemen: 'Jetty', status: 'Pending' }
    ]);

    const [lp] = await pendapatan('INV-F3-1');
    expect(lp).toMatchObject({ bulan: 12, tahun: 2026, status_entry: 'PENDING', kegiatan: 'KM Invoice', no_urut: 1 });
    expect(amount(lp.total)).toBe(10_000_000);
    expect(amount(lp.net_tagihan)).toBe(9_950_000);
  });

  it('nomor invoice ganda di entitas yang sama ditolak', async () => {
    await buat('INV-F3-GANDA');
    const { error } = await admin.rpc('simpan_pencairan', {
      p_entity_id: iljId, p_id: null, p_kapal_id: kapalId, p_bulan: 1, p_tahun: 2026,
      p_nomor: 'INV-F3-GANDA', p_nominal: 1, p_pajak: 0
    });
    expect(error?.code).toBe('23505');
  });

  it('ubah invoice mengikutkan pendapatan, termasuk nomor yang diganti', async () => {
    const id = await buat('INV-F3-LAMA');
    const { error } = await admin.rpc('simpan_pencairan', {
      p_entity_id: iljId, p_id: id, p_kapal_id: kapalId, p_bulan: 11, p_tahun: 2026,
      p_nomor: 'INV-F3-BARU', p_nominal: 20_000_000, p_pajak: 100_000
    });
    expect(error).toBeNull();
    expect(await pendapatan('INV-F3-LAMA')).toHaveLength(0);
    const [lp] = await pendapatan('INV-F3-BARU');
    expect(lp.bulan).toBe(11);
    expect(amount(lp.net_tagihan)).toBe(19_900_000);
  });

  it('PERBAIKAN: pendapatan yang sudah LUNAS tidak diubah oleh Ubah invoice', async () => {
    const id = await buat('INV-F3-LUNAS');
    await sql("update laporan_pendapatan set status_entry = 'LUNAS', payment_date = '2026-12-20' where no_invoice = 'INV-F3-LUNAS'");
    await admin.rpc('simpan_pencairan', {
      p_entity_id: iljId, p_id: id, p_kapal_id: kapalId, p_bulan: 12, p_tahun: 2026,
      p_nomor: 'INV-F3-LUNAS', p_nominal: 1, p_pajak: 0
    });
    const [lp] = await pendapatan('INV-F3-LUNAS');
    expect(amount(lp.total)).toBe(10_000_000);
    expect(lp.status_entry).toBe('LUNAS');
  });

  it('manajer tidak bisa membuat invoice', async () => {
    const { error } = await manager.rpc('simpan_pencairan', {
      p_entity_id: iljId, p_id: null, p_kapal_id: kapalId, p_bulan: 1, p_tahun: 2026,
      p_nomor: 'INV-F3-MANAJER', p_nominal: 1, p_pajak: 0
    });
    expect(error).not.toBeNull();
    expect(await sql("select 1 from pencairan where nomor_invoice = 'INV-F3-MANAJER'")).toHaveLength(0);
  });
});

describe('setujui_pencairan', () => {
  it('ketiga departemen menyetujui → Approved dan PROSES PAYMENT; satu menolak → Rejected dan PENDING', async () => {
    const id = await buat('INV-F3-SETUJU');
    expect((await setujui(id, 'Jetty', 'Approved')).data).toBe('Pending');
    expect((await setujui(id, 'Gudang', 'Approved')).data).toBe('Pending');
    expect((await pendapatan('INV-F3-SETUJU'))[0].status_entry).toBe('PENDING');

    expect((await setujui(id, 'Accounting', 'Approved')).data).toBe('Approved');
    expect(await status(id)).toBe('Approved');
    expect((await pendapatan('INV-F3-SETUJU'))[0].status_entry).toBe('PROSES PAYMENT');

    expect((await setujui(id, 'Gudang', 'Rejected')).data).toBe('Rejected');
    expect((await pendapatan('INV-F3-SETUJU'))[0].status_entry).toBe('PENDING');

    const [g] = await sql<{ tanggal_ttd: string | null }>(
      "select tanggal_ttd::text from pencairan_approval where pencairan_id = $1 and departemen = 'Gudang'",
      [id]
    );
    expect(g.tanggal_ttd).not.toBeNull();
  });

  it('PERBAIKAN: tahun pendapatan = tahun invoice, bukan tahun saat disetujui', async () => {
    const id = await buat('INV-F3-TAHUN', { bulan: 12, tahun: 2025 });
    for (const d of ['Jetty', 'Gudang', 'Accounting']) await setujui(id, d, 'Approved');
    const rows = await pendapatan('INV-F3-TAHUN');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bulan: 12, tahun: 2025, status_entry: 'PROSES PAYMENT' });
  });

  it('pendapatan LUNAS tidak kembali ke PENDING saat persetujuan berubah', async () => {
    const id = await buat('INV-F3-LUNAS2');
    await sql("update laporan_pendapatan set status_entry = 'LUNAS' where no_invoice = 'INV-F3-LUNAS2'");
    await setujui(id, 'Jetty', 'Rejected');
    expect((await pendapatan('INV-F3-LUNAS2'))[0].status_entry).toBe('LUNAS');
  });
});

describe('hapus_pencairan', () => {
  it('menghapus persetujuan dan pendapatan yang belum dibayar', async () => {
    const id = await buat('INV-F3-HAPUS');
    expect((await admin.rpc('hapus_pencairan', { p_pencairan_id: id })).error).toBeNull();
    expect(await sql('select 1 from pencairan_approval where pencairan_id = $1', [id])).toHaveLength(0);
    expect(await pendapatan('INV-F3-HAPUS')).toHaveLength(0);
  });

  it('pendapatan yang sudah dibayar tetap ada', async () => {
    const id = await buat('INV-F3-HAPUS-BAYAR');
    await sql("update laporan_pendapatan set payment_date = '2026-12-28' where no_invoice = 'INV-F3-HAPUS-BAYAR'");
    await admin.rpc('hapus_pencairan', { p_pencairan_id: id });
    expect(await pendapatan('INV-F3-HAPUS-BAYAR')).toHaveLength(1);
  });

  it('manajer tidak bisa menghapus', async () => {
    const id = await buat('INV-F3-HAPUS-MANAJER');
    expect((await manager.rpc('hapus_pencairan', { p_pencairan_id: id })).error).not.toBeNull();
    expect(await sql('select 1 from pencairan where id = $1', [id])).toHaveLength(1);
    expect(await pendapatan('INV-F3-HAPUS-MANAJER')).toHaveLength(1);
  });
});
