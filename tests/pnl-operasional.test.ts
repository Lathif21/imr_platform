/**
 * Draft P&L otomatis dari data operasional platform (migrasi 20250121).
 *
 * Keputusan 13 Oktober 2026: setiap perubahan data operasional memperbarui
 * draft P&L bulan itu — dibuat bila belum ada — dari tabel platform, bukan
 * dari Laravel. Angka yang diharapkan sama dengan tes integrasi lewat layar
 * (tests/e2e/integrasi-operasional.mjs): 345.000 tagihan, 1.725 pajak,
 * 200.000 rekanan, 150.000 saku, 50.000 terpal, 300.000 operasional,
 * 5.000 paguyuban.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { amount, closeDb, entityId, resetFixture, signIn, sql, userId } from './helpers';

let admin: SupabaseClient;
let iljId: string;

async function kegiatanLengkap(nama: string, bulan: number): Promise<number> {
  const tgl = `2026-${String(bulan).padStart(2, '0')}-05`;
  const { data, error } = await admin.rpc('tambah_kegiatan', {
    p_entity_id: iljId,
    p_nama_kapal: nama,
    p_bulan: bulan,
    p_tahun: 2026,
    p_tanggal_input: null,
    p_tanggal_kegiatan: tgl,
    p_tanggal_selesai: tgl,
    p_keterangan: null
  });
  expect(error).toBeNull();
  const id = data as number;
  const [p] = await sql<{ id: number }>('insert into pemilik (entity_id, nama_pemilik) values ($1, $2) returning id::int as id', [iljId, `P ${nama}`]);
  const rincian = await admin.rpc('simpan_rincian_kegiatan', {
    p_rekap_id: id,
    p_rute: 'Gudang Veteran - Kapal/Pelabuhan',
    p_operasional: 300000,
    p_telly_id: null,
    p_tanggal_input: null,
    p_tanggal_kegiatan: tgl,
    p_tanggal_selesai: tgl,
    p_keterangan: null,
    p_truk: [{ nopol: `UJI ${nama.toUpperCase()}`, pemilik_id: p.id, ritase: 2, tonase: 10 }]
  });
  expect(rincian.error).toBeNull();
  const [t] = await sql<{ id: number }>('select id::int as id from transaksi_operasional where operasional_rekap_id = $1', [id]);
  const bayar = await admin.rpc('simpan_pembayaran_truk', {
    p_rekap_id: id,
    p_truk: [{ id: t.id, ritase: 2, tonase: 10, ongkos_angkut: 20000, sangu_supir: 150000, terpal: 50000, paguyuban: 5000 }]
  });
  expect(bayar.error).toBeNull();
  return id;
}

async function periode(bulan: number) {
  const [p] = await sql<{ id: string; status: string }>(
    'select id, status::text from periods where entity_id = $1 and period = $2',
    [iljId, `2026-${String(bulan).padStart(2, '0')}-01`]
  );
  return p;
}

async function baris(periodId: string): Promise<Record<string, number>> {
  const rows = await sql<{ line_code: string; amount: string; source: string }>(
    'select line_code, amount, source from report_lines where period_id = $1',
    [periodId]
  );
  for (const r of rows) expect(r.source).toBe('operasional');
  return Object.fromEntries(rows.map((r) => [r.line_code, amount(r.amount)]));
}

beforeAll(async () => {
  await resetFixture();
  iljId = await entityId('ILJ');
  admin = await signIn('admin.ilj');
  // Bulan uji tidak boleh sudah punya periode dari seed.
  await sql("delete from periods where entity_id = $1 and period >= '2026-01-01'", [iljId]);
});

afterAll(closeDb);

describe('draft P&L otomatis', () => {
  it('kegiatan yang disimpan admin operasional langsung menjadi draft P&L dengan angka yang sama', async () => {
    await kegiatanLengkap('KM PnL Satu', 3);
    const p = await periode(3);
    expect(p?.status).toBe('draft');
    expect(await baris(p.id)).toMatchObject({
      REV_TAGIHAN: 345000,
      COGS_PAJAK: 1725,
      COGS_REKANAN: 200000,
      COGS_SAKU: 150000,
      COGS_TERPAL: 50000,
      COGS_OPS: 300000,
      COGS_PAGUYUBAN: 5000,
      COGS_TELLY: 0,
      OPEX_LAIN: 0
    });
  });

  it('pengeluaran belum dipetakan masuk OPEX_LAIN; pemetaan baru memindahkannya', async () => {
    const { error } = await admin
      .from('pengeluaran')
      .insert({ entity_id: iljId, tanggal: '2026-03-10', jenis: 'Sewa Kantor Uji', jumlah: 77777 });
    expect(error).toBeNull();
    const p = await periode(3);
    expect((await baris(p.id)).OPEX_LAIN).toBe(77777);

    await sql(
      "insert into operational_expense_mapping (entity_id, source, jenis, line_code) values ($1, 'pengeluaran', 'Sewa Kantor Uji', 'OPEX_SEWA')",
      [iljId]
    );
    const sesudah = await baris(p.id);
    expect(sesudah.OPEX_SEWA).toBe(77777);
    expect(sesudah.OPEX_LAIN).toBe(0);
  });

  it('kegiatan yang dipindah bulan: draft lama yang kosong hilang, draft baru muncul', async () => {
    const id = await kegiatanLengkap('KM PnL Pindah', 5);
    expect(await periode(5)).toBeDefined();

    const { error } = await admin.rpc('ubah_kegiatan', {
      p_rekap_id: id,
      p_nama_kapal: 'KM PnL Pindah',
      p_bulan: 6,
      p_tahun: 2026,
      p_tanggal_input: null,
      p_tanggal_kegiatan: '2026-06-05',
      p_tanggal_selesai: '2026-06-05'
    });
    expect(error).toBeNull();

    expect(await periode(5)).toBeUndefined();
    const juni = await periode(6);
    expect((await baris(juni.id)).REV_TAGIHAN).toBe(345000);
  });

  it('periode yang sudah diajukan tidak berubah oleh data operasional baru', async () => {
    await kegiatanLengkap('KM PnL Ajukan', 8);
    const p = await periode(8);
    const staf = await userId('staf.ilj');
    await sql('begin');
    await sql(`set local request.jwt.claims = '{"sub":"${staf}","role":"authenticated"}'`);
    await sql("update periods set status = 'submitted', submitted_by = $2, submitted_at = now() where id = $1", [p.id, staf]);
    await sql('commit');

    await kegiatanLengkap('KM PnL Ajukan Dua', 8);
    expect((await periode(8)).status).toBe('submitted');
    expect((await baris(p.id)).REV_TAGIHAN).toBe(345000);

    // Yang dihitung dari data sekarang memang sudah berbeda — layar Input
    // Laporan menampilkan selisih ini.
    const [now] = await sql<{ amount: string }>(
      "select amount from pnl_operasional_terpetakan($1, '2026-08-01') where line_code = 'REV_TAGIHAN'",
      [iljId]
    );
    expect(amount(now.amount)).toBe(690000);
  });

  it('baris yang diisi manual staf menahan draft dari penghapusan otomatis', async () => {
    const id = await kegiatanLengkap('KM PnL Manual', 9);
    const p = await periode(9);
    await sql("update report_lines set note = 'dicek staf' where period_id = $1 and line_code = 'COGS_OPS'", [p.id]);

    // Sama dengan tombol hapus di Database General.
    const { error } = await admin.from('operasional_rekap').delete().eq('id', id);
    expect(error).toBeNull();
    const masih = await periode(9);
    expect(masih?.id).toBe(p.id);
    expect((await baris(p.id)).REV_TAGIHAN).toBe(0);
  });
});

describe('segarkan_pnl_operasional (tombol di Input Laporan)', () => {
  it('auditor tidak boleh memanggilnya', async () => {
    const auditor = await signIn('auditor');
    const { error } = await auditor.rpc('segarkan_pnl_operasional', { p_entity_id: iljId, p_periode: '2026-03-01' });
    expect(error?.message).toMatch(/tidak berwenang/);
  });

  it('info untuk layar: staf membaca ringkasan entitasnya meski tidak membaca tabel operasional', async () => {
    const staf = await signIn('staf.ilj');
    const tabel = await staf.from('transaksi_operasional').select('id').eq('entity_id', iljId);
    expect(tabel.data ?? []).toEqual([]);

    const { data, error } = await staf.rpc('info_pnl_operasional', { p_entity_id: iljId, p_periode: '2026-03-01' });
    expect(error).toBeNull();
    expect(amount((data as { terhitung: Record<string, string> }).terhitung.REV_TAGIHAN)).toBe(345000);

    const lain = await staf.rpc('info_pnl_operasional', { p_entity_id: await entityId('AMDK'), p_periode: '2026-03-01' });
    expect(lain.error?.message).toMatch(/tidak berwenang/);
  });

  it('staf entitas bisa, dan hasilnya tidak berubah bila datanya tetap', async () => {
    const staf = await signIn('staf.ilj');
    const p = await periode(3);
    const sebelum = await baris(p.id);
    const { data, error } = await staf.rpc('segarkan_pnl_operasional', { p_entity_id: iljId, p_periode: '2026-03-01' });
    expect(error).toBeNull();
    expect(data).toBe('diperbarui');
    expect(await baris(p.id)).toEqual(sebelum);
  });
});

/**
 * Pemetaan biaya di SQL (pnl_operasional_terpetakan), pengganti petakanBiaya
 * di TypeScript: skenario yang sama dengan tes lama operational-mapping.
 */
describe('pemetaan biaya ke pos laporan', () => {
  const BULAN = '2026-11-01';

  async function pos(): Promise<Record<string, number>> {
    const rows = await sql<{ line_code: string; amount: string }>('select line_code, amount from pnl_operasional_terpetakan($1, $2)', [iljId, BULAN]);
    return Object.fromEntries(rows.map((r) => [r.line_code, amount(r.amount)]));
  }

  async function keluar(jenis: string, jumlah: string) {
    await sql("insert into pengeluaran (entity_id, tanggal, jenis, jumlah) values ($1, '2026-11-15', $2, $3)", [iljId, jenis, jumlah]);
  }

  async function petakan(source: string, jenis: string, lineCode: string | null) {
    await sql(
      `insert into operational_expense_mapping (entity_id, source, jenis, line_code) values ($1, $2, $3, $4)
       on conflict (entity_id, source, jenis) do update set line_code = excluded.line_code`,
      [iljId, source, jenis, lineCode]
    );
  }

  beforeAll(async () => {
    await sql('delete from operational_expense_mapping where entity_id = $1', [iljId]);
  });

  it('menjumlahkan jenis yang dipetakan ke pos yang sama, sampai sen', async () => {
    await keluar('Gaji Staf Uji', '1500000.50');
    await keluar('Gaji Sopir Cadangan Uji', '2000000.25');
    await petakan('pengeluaran', 'Gaji Staf Uji', 'OPEX_GAJI');
    await petakan('pengeluaran', 'Gaji Sopir Cadangan Uji', 'OPEX_GAJI');
    expect((await pos()).OPEX_GAJI).toBe(3500000.75);
  });

  it('jenis tanpa pemetaan masuk OPEX_LAIN; "tidak ditarik" dilewati', async () => {
    await keluar('ATK Uji', '125000');
    await keluar('Biaya Pribadi Uji', '999000');
    await petakan('pengeluaran', 'Biaya Pribadi Uji', null);
    const p = await pos();
    expect(p.OPEX_LAIN).toBe(125000);
    expect(Object.values(p).includes(999000)).toBe(false);
  });

  it('gaji admin dari Honor Telly dapat dipetakan ke Gaji Karyawan', async () => {
    const [k] = await sql<{ id: number }>("insert into karyawan (entity_id, nama, jabatan) values ($1, 'Admin Uji', 'Admin') returning id::int as id", [iljId]);
    await sql(
      "insert into gaji_telly (entity_id, karyawan_id, gaji, gaji_total, pph, gaji_bersih, created_at) values ($1, $2, 4000000, 4000000, 0, 4000000, '2026-11-20T10:00:00+07:00')",
      [iljId, k.id]
    );
    expect((await pos()).OPEX_LAIN).toBe(125000 + 4000000);
    await petakan('honor_telly', 'Gaji Admin Bulanan', 'OPEX_GAJI');
    const p = await pos();
    expect(p.OPEX_GAJI).toBe(3500000.75 + 4000000);
    expect(p.OPEX_LAIN).toBe(125000);
  });

  it('pos tujuan pemetaan selalu ada, nol bila bulan ini kosong', async () => {
    await petakan('pengeluaran', 'Sewa Gudang Uji', 'OPEX_SEWA');
    expect((await pos()).OPEX_SEWA).toBe(0);
  });

  it('jenis dibedakan besar-kecil hurufnya, sama seperti pemetaan lama', async () => {
    await keluar('atk uji', '1000');
    await petakan('pengeluaran', 'ATK Uji', 'OPEX_ATK');
    const p = await pos();
    expect(p.OPEX_ATK).toBe(125000);
    expect(p.OPEX_LAIN).toBe(1000);
  });
});

