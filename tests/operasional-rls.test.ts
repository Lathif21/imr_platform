/**
 * Who sees and writes the operational tables, and what the new role can no
 * longer do to the P&L.
 *
 * Same rule as rls.test.ts: an RLS refusal on a read is an empty result, not
 * an error, so reads assert row counts. Writes do fail, with 42501.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  closeDb,
  entityId,
  resetFixture,
  signIn,
  sql,
  templateId,
  userId
} from './helpers';

/**
 * Every operational table: those 20250108000000_operasional.sql creates,
 * and lampiran_operasional (20250119000000_lampiran.sql). Kept here as well as in
 * the migration on purpose: the catalog test below fails when the two
 * disagree, which is the point — a table added to the module and forgotten in
 * the migration's loop would otherwise ship with no RLS at all.
 */
const OPERATIONAL_TABLES = [
  'pemilik',
  'kapal',
  'karyawan',
  'karyawan_catatan',
  'kendaraan',
  'kapal_rute',
  'kapal_muatan_detail',
  'operasional_rekap',
  'transaksi_operasional',
  'gaji_telly',
  'paguyuban',
  'pengeluaran',
  'pencairan',
  'pencairan_approval',
  'laporan_pendapatan',
  'laporan_kumpulan',
  // 20250119000000_lampiran.sql — same policy pair, written out there.
  'lampiran_operasional',
  // 20250127000000_pajak_partner.sql — likewise.
  'pajak_partner'
];

let admin: SupabaseClient;
let direksi: SupabaseClient;
let staff: SupabaseClient;
let manager: SupabaseClient;
let auditor: SupabaseClient;

let iljId: string;
let amdkId: string;
let iljKapal: number;
let amdkKapal: number;

beforeAll(async () => {
  await resetFixture();

  iljId = await entityId('ILJ');
  amdkId = await entityId('AMDK');

  // Arranged as postgres: RLS does not apply, triggers do. `id::int`
  // because node-postgres hands bigint back as a string, while PostgREST
  // returns it as a JSON number.
  [{ id: iljKapal }] = await sql<{ id: number }>(
    "insert into kapal (entity_id, nama_kapal) values ($1, 'KM Uji ILJ') returning id::int as id",
    [iljId]
  );
  [{ id: amdkKapal }] = await sql<{ id: number }>(
    "insert into kapal (entity_id, nama_kapal) values ($1, 'KM Uji AMDK') returning id::int as id",
    [amdkId]
  );

  admin = await signIn('admin.ilj');
  direksi = await signIn('direksi');
  staff = await signIn('staf.ilj');
  manager = await signIn('manajer');
  auditor = await signIn('auditor');
});

afterAll(closeDb);

describe('katalog', () => {
  it('setiap tabel operasional ber-RLS dan punya policy baca dan tulis', async () => {
    const rows = await sql<{ table_name: string; rls: boolean; policies: string[] }>(
      `select c.relname as table_name,
              c.relrowsecurity as rls,
              coalesce(array_agg(p.polname::text order by p.polname)
                       filter (where p.polname is not null), '{}'::text[]) as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
         left join pg_policy p on p.polrelid = c.oid
        where c.relname = any($1)
        group by c.relname, c.relrowsecurity`,
      [OPERATIONAL_TABLES]
    );

    expect(rows.map((r) => r.table_name).sort()).toEqual([...OPERATIONAL_TABLES].sort());
    for (const row of rows) {
      expect(row.rls, row.table_name).toBe(true);
      expect(row.policies, row.table_name).toEqual([
        `${row.table_name}_select`,
        `${row.table_name}_write`
      ]);
    }
  });

  it('setiap tabel operasional diaudit trigger', async () => {
    const rows = await sql<{ table_name: string }>(
      `select c.relname as table_name
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_proc f on f.oid = t.tgfoid
        where f.proname = 'audit_row' and c.relname = any($1)`,
      [OPERATIONAL_TABLES]
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([...OPERATIONAL_TABLES].sort());
  });

  /**
   * `can_read_operational(entity_id)` in a policy runs once per row — 9,3 s
   * for 20.000 rows — because a SECURITY DEFINER function cannot be inlined
   * (20250128000000_rls_sekali_per_query.sql). The set form runs once.
   */
  it('policy operasional menghitung akses sekali per query', async () => {
    const rows = await sql<{ name: string; expr: string }>(
      `select tablename || '.' || policyname as name,
              coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
         from pg_policies
        where schemaname = 'public' and tablename = any($1)`,
      [OPERATIONAL_TABLES]
    );
    for (const row of rows) {
      expect(row.expr, row.name).not.toMatch(/can_(read|write)_operational\(entity_id\)/);
      expect(row.expr, row.name).toMatch(/entitas_(baca|tulis)_operasional\(\)/);
    }
  });

  it('pembatasan akses tetap sama untuk baris yang dibaca dalam jumlah besar', async () => {
    await sql(
      `insert into pemilik (entity_id, nama_pemilik)
       select case when g % 2 = 0 then $1::uuid else $2::uuid end, 'Massal ' || g
         from generate_series(1, 2000) g`,
      [iljId, amdkId]
    );
    const { count, error } = await admin
      .from('pemilik')
      .select('id', { count: 'exact', head: true })
      .like('nama_pemilik', 'Massal %');
    expect(error).toBeNull();
    expect(count).toBe(1000);
  });
});

describe('admin operasional', () => {
  it('melihat data operasional entitasnya, tidak entitas lain', async () => {
    const { data, error } = await admin.from('kapal').select('nama_kapal');
    expect(error).toBeNull();
    expect(data?.map((r) => r.nama_kapal)).toEqual(['KM Uji ILJ']);
  });

  it('dapat menulis untuk entitasnya', async () => {
    const { error } = await admin
      .from('pemilik')
      .insert({ entity_id: iljId, nama_pemilik: 'Pemilik Uji' });
    expect(error).toBeNull();
  });

  it('tidak dapat menulis untuk entitas yang tidak ditugaskan', async () => {
    const { error } = await admin
      .from('pemilik')
      .insert({ entity_id: amdkId, nama_pemilik: 'Pemilik Nyasar' });
    expect(error?.code).toBe('42501');
  });

  it('created_by diisi dari sesi, bukan dari klien', async () => {
    const someoneElse = await userId('direksi');
    const self = await userId('admin.ilj');

    const { data, error } = await admin
      .from('transaksi_operasional')
      .insert({
        entity_id: iljId,
        tanggal: '2026-08-03',
        kapal_id: iljKapal,
        rute: 'Gudang Veteran - Pelabuhan',
        created_by: someoneElse,
        updated_by: someoneElse
      })
      .select('id')
      .single();
    expect(error).toBeNull();

    const [row] = await sql<{ created_by: string; updated_by: string }>(
      'select created_by, updated_by from transaksi_operasional where id = $1',
      [data!.id]
    );
    expect(row).toEqual({ created_by: self, updated_by: self });
  });

  it('setiap tulis tercatat di audit_log dengan pelakunya', async () => {
    const self = await userId('admin.ilj');
    const rows = await sql<{ actor_id: string }>(
      "select actor_id from audit_log where table_name = 'pemilik' and action = 'INSERT'"
    );
    expect(rows.map((r) => r.actor_id)).toContain(self);
  });

  it('membaca laporan laba rugi entitasnya saja', async () => {
    const { data: periods } = await admin.from('periods').select('entity_id');
    expect(periods?.length).toBeGreaterThan(0);
    expect([...new Set(periods?.map((r) => r.entity_id))]).toEqual([iljId]);

    const { data: pnl } = await admin.from('v_period_pnl').select('entity_code');
    expect([...new Set(pnl?.map((r) => r.entity_code))]).toEqual(['ILJ']);
  });

  it('tidak dapat mengubah baris laporan, bahkan pada periode draft', async () => {
    const [draft] = await sql<{ id: string }>(
      "select id from periods where entity_id = $1 and status = 'draft' limit 1",
      [iljId]
    );
    const period =
      draft?.id ??
      (
        await sql<{ id: string }>(
          "insert into periods (entity_id, period, template_id) values ($1, '2026-07-01', $2) returning id",
          [iljId, await templateId()]
        )
      )[0].id;

    const { error } = await admin
      .from('report_lines')
      .insert({ period_id: period, line_code: 'REV_TAGIHAN', amount: 1 });
    expect(error?.code).toBe('42501');
  });

  it('tidak dapat membuat periode laporan meski ditugaskan ke entitasnya', async () => {
    const { error } = await admin
      .from('periods')
      .insert({ entity_id: iljId, period: '2026-09-01', template_id: await templateId() });
    expect(error?.code).toBe('42501');
  });

  it('kehilangan akses begitu profilnya dinonaktifkan', async () => {
    const self = await userId('admin.ilj');
    await sql('update profiles set is_active = false where id = $1', [self]);
    try {
      const { data } = await admin.from('kapal').select('id');
      expect(data).toEqual([]);
    } finally {
      await sql('update profiles set is_active = true where id = $1', [self]);
    }
  });
});

describe('referensi antar-entitas', () => {
  it('baris entitas A tidak dapat menunjuk baris entitas B', async () => {
    // As postgres, so RLS is out of the way and only the constraint can refuse.
    const [{ id: pemilikAmdk }] = await sql<{ id: number }>(
      "insert into pemilik (entity_id, nama_pemilik) values ($1, 'Pemilik AMDK') returning id::int as id",
      [amdkId]
    );
    await expect(
      sql("insert into kendaraan (entity_id, nopol, pemilik_id) values ($1, 'L 1 XX', $2)", [
        iljId,
        pemilikAmdk
      ])
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('menghapus induk melepas rujukan SET NULL tanpa menyentuh entity_id', async () => {
    const [{ id: telly }] = await sql<{ id: number }>(
      "insert into karyawan (entity_id, nama) values ($1, 'Telly Uji') returning id::int as id",
      [iljId]
    );
    const [{ id: rekap }] = await sql<{ id: number }>(
      'insert into operasional_rekap (entity_id, bulan, tahun, kapal_id, telly_id) values ($1, 8, 2026, $2, $3) returning id::int as id',
      [iljId, iljKapal, telly]
    );

    await sql('delete from karyawan where id = $1', [telly]);

    const [row] = await sql<{ telly_id: number | null; entity_id: string }>(
      'select telly_id, entity_id from operasional_rekap where id = $1',
      [rekap]
    );
    expect(row).toEqual({ telly_id: null, entity_id: iljId });
  });
});

describe('direksi', () => {
  it('membaca data operasional seluruh entitas', async () => {
    const { data } = await direksi.from('kapal').select('id').order('id');
    expect(data?.map((r) => r.id)).toEqual([iljKapal, amdkKapal]);
  });

  it('tidak menulis data operasional', async () => {
    const { error } = await direksi
      .from('pemilik')
      .insert({ entity_id: iljId, nama_pemilik: 'Ditulis Direksi' });
    expect(error?.code).toBe('42501');
  });
});

describe('peran laporan', () => {
  it('staf entitas tidak melihat data operasional', async () => {
    const { data } = await staff.from('kapal').select('id');
    expect(data).toEqual([]);
  });

  it.each([
    ['manajer keuangan', () => manager],
    ['auditor', () => auditor]
  ])('%s membaca data operasional tetapi tidak menulisnya', async (_, client) => {
    const { data } = await client().from('kapal').select('id').order('id');
    expect(data?.map((r) => r.id)).toEqual([iljKapal, amdkKapal]);

    const { error } = await client()
      .from('pemilik')
      .insert({ entity_id: iljId, nama_pemilik: 'Ditulis Peran Laporan' });
    expect(error?.code).toBe('42501');
  });

  it('staf entitas tetap dapat membuat periode laporan', async () => {
    // Regression guard for the policy rewrite: can_write_reports() must keep
    // what `not is_readonly_role()` allowed for the four original roles.
    const { error } = await staff
      .from('periods')
      .insert({ entity_id: iljId, period: '2026-10-01', template_id: await templateId() });
    expect(error).toBeNull();
  });
});
