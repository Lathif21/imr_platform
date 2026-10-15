/**
 * Fase 5 — aktivitas_operasional (migrasi 20250117): the collaboration feed.
 *
 * It reads audit_log on behalf of roles that may not read audit_log, so what
 * it must NOT return matters as much as what it does: the caller's own
 * actions, other entities, and anything for an account not assigned to the entity.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { closeDb, entityId, resetFixture, signIn, sql, userId } from './helpers';

let admin: SupabaseClient;
let manager: SupabaseClient;
let iljId: string;

interface Aktivitas {
  id: number;
  pelaku: string;
  aksi: string;
  tabel: string;
  label: string;
  jumlah: number;
}

beforeAll(async () => {
  await resetFixture();
  iljId = await entityId('ILJ');
  admin = await signIn('admin.ilj');
  manager = await signIn('manajer');
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

describe('aktivitas_operasional', () => {
  it('satu simpanan menjadi satu baris, dinamai menurut tabel yang paling mewakili', async () => {
    const { data: awal } = await manager.rpc('kursor_aktivitas');
    const { error } = await admin.rpc('tambah_kegiatan', {
      p_entity_id: iljId, p_nama_kapal: 'KM Kolaborasi', p_bulan: 10, p_tahun: 2026,
      p_tanggal_input: null, p_tanggal_kegiatan: null, p_tanggal_selesai: null, p_keterangan: null
    });
    expect(error).toBeNull();

    const { data, error: e2 } = await manager.rpc('aktivitas_operasional', { p_entity_id: iljId, p_setelah: awal });
    expect(e2).toBeNull();
    const rows = data as Aktivitas[];
    expect(rows).toHaveLength(1);
    // kapal baru + kegiatan + baris pendapatan, dalam satu transaksi
    expect(rows[0]).toMatchObject({ aksi: 'INSERT', tabel: 'operasional_rekap', label: 'kegiatan kapal KM Kolaborasi' });
    expect(rows[0].jumlah).toBeGreaterThanOrEqual(3);
    expect(rows[0].pelaku).not.toBe('Pengguna lain');
  });

  it('aksi sendiri tidak dikembalikan', async () => {
    const { data: awal } = await admin.rpc('kursor_aktivitas');
    await admin.rpc('tambah_kegiatan', {
      p_entity_id: iljId, p_nama_kapal: 'KM Sendiri', p_bulan: 10, p_tahun: 2026,
      p_tanggal_input: null, p_tanggal_kegiatan: null, p_tanggal_selesai: null, p_keterangan: null
    });
    const { data } = await admin.rpc('aktivitas_operasional', { p_entity_id: iljId, p_setelah: awal });
    expect(data).toEqual([]);
  });

  it('kosong untuk pengguna yang tidak ditugaskan ke entitas itu, dan tidak membocorkan nilai data', async () => {
    const { data: awal } = await manager.rpc('kursor_aktivitas');
    await admin.rpc('tambah_kegiatan', {
      p_entity_id: iljId, p_nama_kapal: 'KM Rahasia', p_bulan: 10, p_tahun: 2026,
      p_tanggal_input: null, p_tanggal_kegiatan: null, p_tanggal_selesai: null, p_keterangan: null
    });
    await tanpaAksesIlj(async (tanpaIlj) => {
      const { data } = await tanpaIlj.rpc('aktivitas_operasional', { p_entity_id: iljId, p_setelah: awal });
      expect(data ?? []).toEqual([]);
    });

    const { data: dariManajer } = await manager.rpc('aktivitas_operasional', { p_entity_id: iljId, p_setelah: awal });
    expect(Object.keys((dariManajer as Aktivitas[])[0]).sort()).toEqual(['aksi', 'id', 'jumlah', 'label', 'pelaku', 'tabel', 'waktu']);
  });

  it('hanya entitas yang diminta', async () => {
    const { data: awal } = await manager.rpc('kursor_aktivitas');
    const lain = await entityId('AMDK');
    await sql("insert into kapal (entity_id, nama_kapal) values ($1, 'KM Entitas Lain')", [lain]);
    await sql(
      `insert into audit_log (actor_id, table_name, record_pk, action, new_value)
       select id, 'kapal', '999999', 'INSERT', jsonb_build_object('entity_id', $1::text, 'nama_kapal', 'KM Entitas Lain')
         from profiles where role = 'admin_operasional' limit 1`,
      [lain]
    );
    const { data } = await manager.rpc('aktivitas_operasional', { p_entity_id: iljId, p_setelah: awal });
    expect((data as Aktivitas[]).some((r) => r.label.includes('Entitas Lain'))).toBe(false);
  });
});
