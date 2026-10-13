/**
 * Fase 2 — fungsi kegiatan kapal (migrasi 20250113).
 *
 * Rumus Laravel yang dijaga: jumlah kegiatan dari truk, beban rekanan =
 * tonase × ongkos angkut, iuran paguyuban = tonase × tarif, honor telly =
 * tonase kegiatan × gaji per ton. Ditambah setiap PERBAIKAN yang dicatat di
 * migrasi — masing-masing pernah merusak data di Laravel.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { amount, closeDb, entityId, resetFixture, signIn, sql } from './helpers';

let admin: SupabaseClient;
let manager: SupabaseClient;
let iljId: string;

async function tambah(nama: string, bulan = 9, tanggalKegiatan: string | null = '2026-09-12'): Promise<number> {
  const { data, error } = await admin.rpc('tambah_kegiatan', {
    p_entity_id: iljId,
    p_nama_kapal: nama,
    p_bulan: bulan,
    p_tahun: 2026,
    p_tanggal_input: '2026-09-15',
    p_tanggal_kegiatan: tanggalKegiatan,
    p_tanggal_selesai: null,
    p_keterangan: null
  });
  expect(error).toBeNull();
  return data as number;
}

interface Truk {
  nopol: string;
  pemilik_id?: number | null;
  pemilik_baru?: string;
  ritase: number;
  tonase: number;
}

function rincian(rekap: number, truk: Truk[], extra: { telly?: number | null; operasional?: number | null } = {}) {
  return admin.rpc('simpan_rincian_kegiatan', {
    p_rekap_id: rekap,
    p_rute: 'Gudang Veteran - Kapal/Pelabuhan',
    p_operasional: extra.operasional === undefined ? 0 : extra.operasional,
    p_telly_id: extra.telly ?? null,
    p_tanggal_input: null,
    p_tanggal_kegiatan: '2026-09-12',
    p_tanggal_selesai: '2026-09-14',
    p_keterangan: null,
    p_truk: truk
  });
}

async function rekap(id: number) {
  const [row] = await sql<{ trips: number; tonase: string; sangu_supir: string; terpal: string; operasional: string | null; bulan: number; kapal_id: number }>(
    'select trips, tonase, sangu_supir, terpal, operasional, bulan, kapal_id::int from operasional_rekap where id = $1',
    [id]
  );
  return row;
}

async function truk(rekapId: number) {
  return sql<{ id: number; nopol: string; ritase: number; tonase: string; pendapatan: string; tanggal: string; pemilik_id: number }>(
    `select t.id::int, k.nopol, t.ritase, t.tonase, t.pendapatan, t.tanggal::text, k.pemilik_id::int
       from transaksi_operasional t join kendaraan k on k.id = t.kendaraan_id
      where t.operasional_rekap_id = $1 order by k.nopol`,
    [rekapId]
  );
}

async function pemilik(nama: string): Promise<number> {
  const [row] = await sql<{ id: number }>(
    'insert into pemilik (entity_id, nama_pemilik) values ($1, $2) returning id::int as id',
    [iljId, nama]
  );
  return row.id;
}

beforeAll(async () => {
  await resetFixture();
  iljId = await entityId('ILJ');
  admin = await signIn('admin.ilj');
  manager = await signIn('manajer');
});

afterAll(closeDb);

describe('tambah_kegiatan', () => {
  it('membuat kapal baru bila namanya belum ada, dan memakai kapal yang sama tanpa peduli huruf/spasi', async () => {
    const a = await tambah('KM Uji Satu');
    const b = await tambah('  km   uji satu ');
    const [ra, rb] = [await rekap(a), await rekap(b)];
    expect(ra.kapal_id).toBe(rb.kapal_id);
    const [{ n }] = await sql<{ n: number }>(
      "select count(*)::int as n from kapal where entity_id = $1 and lower(nama_kapal) = 'km uji satu'",
      [iljId]
    );
    expect(n).toBe(1);
  });

  it('PERBAIKAN: kapal yang sama di bulan yang sama menjadi kegiatan baru, tidak menimpa yang lama', async () => {
    const pertama = await tambah('KM Tidak Ditimpa');
    const p = await pemilik('P Tidak Ditimpa');
    expect((await rincian(pertama, [{ nopol: 'UJI 1001', pemilik_id: p, ritase: 2, tonase: 20 }], { operasional: 500000 })).error).toBeNull();

    const kedua = await tambah('KM Tidak Ditimpa');
    expect(kedua).not.toBe(pertama);

    const r = await rekap(pertama);
    expect(amount(r.tonase)).toBe(20);
    expect(amount(r.operasional)).toBe(500000);
  });

  it('ditolak untuk peran yang tidak menulis data operasional', async () => {
    const { error } = await manager.rpc('tambah_kegiatan', {
      p_entity_id: iljId,
      p_nama_kapal: 'KM Manajer',
      p_bulan: 9,
      p_tahun: 2026,
      p_tanggal_input: null,
      p_tanggal_kegiatan: null,
      p_tanggal_selesai: null,
      p_keterangan: null
    });
    expect(error).not.toBeNull();
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from kapal where nama_kapal = 'KM Manajer'");
    expect(n).toBe(0);
  });
});

describe('simpan_rincian_kegiatan', () => {
  it('biaya operasional: kosong tetap belum diisi (null), 0 tersimpan sebagai Rp 0', async () => {
    const id = await tambah('KM Operasional Nol');
    expect((await rekap(id)).operasional).toBeNull();

    expect((await rincian(id, [], { operasional: 0 })).error).toBeNull();
    expect(amount((await rekap(id)).operasional)).toBe(0);

    expect((await rincian(id, [], { operasional: null })).error).toBeNull();
    expect((await rekap(id)).operasional).toBeNull();
  });

  it('menjumlah truk ke kegiatan, dengan tanggal truk di bulan kegiatan', async () => {
    const id = await tambah('KM Jumlah');
    const p = await pemilik('P Jumlah');
    const { error } = await rincian(id, [
      { nopol: 'uji 2001', pemilik_id: p, ritase: 3, tonase: 30.5 },
      { nopol: 'UJI 2002', pemilik_id: p, ritase: 1, tonase: 9.5 }
    ], { operasional: 750000 });
    expect(error).toBeNull();

    const r = await rekap(id);
    expect(r.trips).toBe(4);
    expect(amount(r.tonase)).toBe(40);
    expect(amount(r.operasional)).toBe(750000);

    const rows = await truk(id);
    expect(rows.map((t) => t.nopol)).toEqual(['UJI 2001', 'UJI 2002']);
    expect(rows.every((t) => t.tanggal === '2026-09-12')).toBe(true);
  });

  it('tanggal truk jatuh ke tanggal 1 bila tanggal kegiatan di luar bulannya', async () => {
    const id = await tambah('KM Lintas Bulan', 10, null);
    const p = await pemilik('P Lintas');
    // tanggal kegiatan 12 September untuk kegiatan bulan Oktober
    expect((await rincian(id, [{ nopol: 'UJI 2101', pemilik_id: p, ritase: 1, tonase: 5 }])).error).toBeNull();
    expect((await truk(id))[0].tanggal).toBe('2026-10-01');
  });

  it('PERBAIKAN: truk lama tidak berganti pemilik; pemilik baru yang diketik dibuat', async () => {
    const pLama = await pemilik('P Asli');
    const pLain = await pemilik('P Lain');
    await sql('insert into kendaraan (entity_id, nopol, pemilik_id) values ($1, $2, $3)', [iljId, 'UJI 3001', pLama]);

    const id = await tambah('KM Pemilik');
    const { error } = await rincian(id, [
      { nopol: 'UJI 3001', pemilik_id: pLain, ritase: 1, tonase: 10 },
      { nopol: 'UJI 3002', pemilik_baru: 'CV Rekanan Baru', ritase: 1, tonase: 10 }
    ]);
    expect(error).toBeNull();

    const rows = await truk(id);
    expect(rows[0].pemilik_id).toBe(pLama);
    const [baru] = await sql<{ nama_pemilik: string }>('select nama_pemilik from pemilik where id = $1', [rows[1].pemilik_id]);
    expect(baru.nama_pemilik).toBe('CV Rekanan Baru');
  });

  it('menolak truk baru tanpa pemilik dan truk yang tercantum dua kali, tanpa menyimpan apa pun', async () => {
    const id = await tambah('KM Tolak');
    const p = await pemilik('P Tolak');

    const tanpaPemilik = await rincian(id, [{ nopol: 'UJI 4001', ritase: 1, tonase: 1 }]);
    expect(tanpaPemilik.error?.message).toContain('belum terdaftar');

    const ganda = await rincian(id, [
      { nopol: 'UJI 4002', pemilik_id: p, ritase: 1, tonase: 1 },
      { nopol: 'uji 4002', pemilik_id: p, ritase: 1, tonase: 1 }
    ]);
    expect(ganda.error?.message).toContain('lebih dari sekali');

    expect(await truk(id)).toHaveLength(0);
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from kendaraan where nopol = 'UJI 4002'");
    expect(n).toBe(0);
  });

  it('truk yang dikeluarkan dari daftar terhapus beserta iuran paguyubannya', async () => {
    const id = await tambah('KM Keluar');
    const p = await pemilik('P Keluar');
    await rincian(id, [
      { nopol: 'UJI 5001', pemilik_id: p, ritase: 1, tonase: 10 },
      { nopol: 'UJI 5002', pemilik_id: p, ritase: 1, tonase: 10 }
    ]);
    const keluar = (await truk(id))[1].id;

    expect((await rincian(id, [{ nopol: 'UJI 5001', pemilik_id: p, ritase: 1, tonase: 10 }])).error).toBeNull();
    expect((await truk(id)).map((t) => t.nopol)).toEqual(['UJI 5001']);
    const [{ n }] = await sql<{ n: number }>('select count(*)::int as n from paguyuban where transaksi_id = $1', [keluar]);
    expect(n).toBe(0);
    expect(amount((await rekap(id)).tonase)).toBe(10);
  });

  it('PERBAIKAN: tonase 0 tersimpan 0; beban rekanan ikut tonase, iuran paguyuban manual tidak', async () => {
    const id = await tambah('KM Nol');
    const p = await pemilik('P Nol');
    await rincian(id, [{ nopol: 'UJI 6001', pemilik_id: p, ritase: 1, tonase: 10 }]);
    const [t] = await truk(id);
    await admin.rpc('simpan_pembayaran_truk', {
      p_rekap_id: id,
      p_truk: [{ id: t.id, ritase: 1, tonase: 10, ongkos_angkut: 20000, sangu_supir: 0, terpal: 0, paguyuban: 7000 }]
    });
    const pag = async () =>
      (await sql<{ total_bayar: string; tarif: string }>('select total_bayar, tarif from paguyuban where transaksi_id = $1', [t.id]))[0];

    expect((await rincian(id, [{ nopol: 'UJI 6001', pemilik_id: p, ritase: 1, tonase: 12 }])).error).toBeNull();
    let [after] = await truk(id);
    expect(amount(after.pendapatan)).toBe(240000);
    expect(amount((await pag()).total_bayar)).toBe(7000);
    expect(amount((await pag()).tarif)).toBe(583.33);

    expect((await rincian(id, [{ nopol: 'UJI 6001', pemilik_id: p, ritase: 1, tonase: 0 }])).error).toBeNull();
    [after] = await truk(id);
    expect(amount(after.tonase)).toBe(0);
    expect(amount((await pag()).total_bayar)).toBe(7000);
    expect(amount((await pag()).tarif)).toBe(0);
  });
});

describe('simpan_pembayaran_truk', () => {
  it('beban rekanan = tonase × ongkos; paguyuban diisi manual; kegiatan dijumlah ulang', async () => {
    const id = await tambah('KM Bayar');
    const p = await pemilik('P Bayar');
    await rincian(id, [
      { nopol: 'UJI 7001', pemilik_id: p, ritase: 1, tonase: 1 },
      { nopol: 'UJI 7002', pemilik_id: p, ritase: 1, tonase: 1 }
    ]);
    const [a, b] = await truk(id);

    const { error } = await admin.rpc('simpan_pembayaran_truk', {
      p_rekap_id: id,
      p_truk: [
        { id: a.id, ritase: 2, tonase: 25, ongkos_angkut: 18000, sangu_supir: 150000, terpal: 50000, paguyuban: 10000 },
        { id: b.id, ritase: 1, tonase: 15, ongkos_angkut: 18000, sangu_supir: 100000, terpal: 0, paguyuban: null }
      ]
    });
    expect(error).toBeNull();

    const rows = await truk(id);
    expect(amount(rows[0].pendapatan)).toBe(450000);
    expect(amount(rows[1].pendapatan)).toBe(270000);

    // Truk b belum diisi: tidak ada baris iuran, bukan tonase × 500.
    const pag = await sql<{ transaksi_id: number; total_bayar: string; tarif: string }>(
      'select transaksi_id::int, total_bayar, tarif from paguyuban where transaksi_id = any($1) order by transaksi_id',
      [[a.id, b.id]]
    );
    expect(pag.map((x) => [x.transaksi_id, amount(x.total_bayar), amount(x.tarif)])).toEqual([[a.id, 10000, 400]]);

    const r = await rekap(id);
    expect(r.trips).toBe(3);
    expect(amount(r.tonase)).toBe(40);
    expect(amount(r.sangu_supir)).toBe(250000);
    expect(amount(r.terpal)).toBe(50000);
  });

  it('tonase tiga desimal tersimpan apa adanya, tidak dibulatkan', async () => {
    const id = await tambah('KM Tiga Desimal');
    const p = await pemilik('P Tiga Desimal');
    await rincian(id, [{ nopol: 'UJI 7201', pemilik_id: p, ritase: 1, tonase: 12.125 }]);
    const [t] = await truk(id);
    expect(amount(t.tonase)).toBe(12.125);

    const { error } = await admin.rpc('simpan_pembayaran_truk', {
      p_rekap_id: id,
      p_truk: [{ id: t.id, ritase: 1, tonase: 10.375, ongkos_angkut: 20000, sangu_supir: 0, terpal: null }]
    });
    expect(error).toBeNull();
    const [setelah] = await truk(id);
    expect(amount(setelah.tonase)).toBe(10.375);
    expect(amount(setelah.pendapatan)).toBe(207500);
    expect(amount((await rekap(id)).tonase)).toBe(10.375);
  });

  it('terpal: kosong tetap belum diisi (null), 0 tersimpan sebagai Rp 0', async () => {
    const id = await tambah('KM Terpal Nol');
    const p = await pemilik('P Terpal Nol');
    await rincian(id, [{ nopol: 'UJI 7301', pemilik_id: p, ritase: 1, tonase: 1 }]);
    const [t] = await truk(id);
    const terpal = async () => (await sql<{ terpal: string | null }>('select terpal from transaksi_operasional where id = $1', [t.id]))[0].terpal;
    expect(await terpal()).toBeNull();

    const bayar = (nilai: number | null) =>
      admin.rpc('simpan_pembayaran_truk', {
        p_rekap_id: id,
        p_truk: [{ id: t.id, ritase: 1, tonase: 1, ongkos_angkut: 0, sangu_supir: 0, terpal: nilai }]
      });

    expect((await bayar(0)).error).toBeNull();
    expect(await terpal()).toBe('0.00');

    expect((await bayar(null)).error).toBeNull();
    expect(await terpal()).toBeNull();
    expect(amount((await rekap(id)).terpal)).toBe(0);
  });

  it('paguyuban: 0 tersimpan Rp 0, null menghapus, kunci tidak ada tidak menyentuh', async () => {
    const id = await tambah('KM Paguyuban Manual');
    const p = await pemilik('P Paguyuban Manual');
    await rincian(id, [{ nopol: 'UJI 7401', pemilik_id: p, ritase: 1, tonase: 10 }]);
    const [t] = await truk(id);
    const iuran = async () => (await sql<{ total_bayar: string }>('select total_bayar from paguyuban where transaksi_id = $1', [t.id]))[0]?.total_bayar ?? null;
    expect(await iuran()).toBeNull();

    const bayar = (extra: Record<string, unknown>) =>
      admin.rpc('simpan_pembayaran_truk', {
        p_rekap_id: id,
        p_truk: [{ id: t.id, ritase: 1, tonase: 10, ongkos_angkut: 0, sangu_supir: 0, terpal: null, ...extra }]
      });

    expect((await bayar({ paguyuban: 0 })).error).toBeNull();
    expect(await iuran()).toBe('0.00');
    expect((await bayar({ paguyuban: 8000 })).error).toBeNull();
    expect(amount(await iuran())).toBe(8000);
    expect((await bayar({})).error).toBeNull();
    expect(amount(await iuran())).toBe(8000);
    expect((await bayar({ paguyuban: -1 })).error?.code).toBe('P0001');
    expect((await bayar({ paguyuban: null })).error).toBeNull();
    expect(await iuran()).toBeNull();
  });

  it('menolak baris truk milik kegiatan lain', async () => {
    const satu = await tambah('KM Milik Satu');
    const dua = await tambah('KM Milik Dua');
    const p = await pemilik('P Milik');
    await rincian(satu, [{ nopol: 'UJI 7101', pemilik_id: p, ritase: 1, tonase: 1 }]);
    const [t] = await truk(satu);

    const { error } = await admin.rpc('simpan_pembayaran_truk', {
      p_rekap_id: dua,
      p_truk: [{ id: t.id, ritase: 1, tonase: 99, ongkos_angkut: 1, sangu_supir: 0, terpal: 0 }]
    });
    expect(error?.code).toBe('P0001');
    expect(amount((await truk(satu))[0].tonase)).toBe(1);
  });
});

describe('honor telly per kegiatan', () => {
  it('tonase × tarif telly, PPh dipertahankan, tarif petugas baru dipakai saat petugas diganti', async () => {
    const [budi] = await sql<{ id: number }>(
      "insert into karyawan (entity_id, nama, jabatan, tarif_telly) values ($1, 'Telly Budi', 'Telly', 450) returning id::int as id",
      [iljId]
    );
    const [ani] = await sql<{ id: number }>(
      "insert into karyawan (entity_id, nama, jabatan, tarif_telly) values ($1, 'Telly Ani', 'Telly', 0) returning id::int as id",
      [iljId]
    );
    const id = await tambah('KM Telly');
    const p = await pemilik('P Telly');
    const daftar = [{ nopol: 'UJI 8001', pemilik_id: p, ritase: 1, tonase: 100 }];

    await rincian(id, daftar, { telly: budi.id });
    let [g] = await sql<{ karyawan_id: number; gaji: string; gaji_total: string; gaji_bersih: string }>(
      'select karyawan_id::int, gaji, gaji_total, gaji_bersih from gaji_telly where operasional_rekap_id = $1',
      [id]
    );
    expect(amount(g.gaji)).toBe(450);
    expect(amount(g.gaji_total)).toBe(45000);

    await sql('update gaji_telly set pph = 1000 where operasional_rekap_id = $1', [id]);
    await rincian(id, daftar, { telly: budi.id });
    [g] = await sql('select karyawan_id::int, gaji, gaji_total, gaji_bersih from gaji_telly where operasional_rekap_id = $1', [id]);
    expect(amount(g.gaji_bersih)).toBe(44000);

    // Tarif Ani 0 → 400, bukan tarif Budi yang tertinggal.
    await rincian(id, daftar, { telly: ani.id });
    [g] = await sql('select karyawan_id::int, gaji, gaji_total, gaji_bersih from gaji_telly where operasional_rekap_id = $1', [id]);
    expect(g.karyawan_id).toBe(ani.id);
    expect(amount(g.gaji)).toBe(400);
    expect(amount(g.gaji_total)).toBe(40000);

    await rincian(id, daftar, { telly: null });
    expect(await sql('select 1 from gaji_telly where operasional_rekap_id = $1', [id])).toHaveLength(0);
  });
});

describe('ubah_kegiatan', () => {
  it('PERBAIKAN: memindahkan kegiatan ke bulan lain ikut memindahkan truk dan iurannya', async () => {
    const id = await tambah('KM Pindah');
    const p = await pemilik('P Pindah');
    await rincian(id, [{ nopol: 'UJI 9001', pemilik_id: p, ritase: 1, tonase: 10 }]);
    const [awal] = await truk(id);
    await admin.rpc('simpan_pembayaran_truk', {
      p_rekap_id: id,
      p_truk: [{ id: awal.id, ritase: 1, tonase: 10, ongkos_angkut: 0, sangu_supir: 0, terpal: null, paguyuban: 5000 }]
    });

    const { error } = await admin.rpc('ubah_kegiatan', {
      p_rekap_id: id,
      p_nama_kapal: 'KM Pindah Baru',
      p_bulan: 10,
      p_tahun: 2026,
      p_tanggal_input: null,
      p_tanggal_kegiatan: '2026-10-03',
      p_tanggal_selesai: null
    });
    expect(error).toBeNull();

    const r = await rekap(id);
    expect(r.bulan).toBe(10);
    const [t] = await truk(id);
    expect(t.tanggal).toBe('2026-10-03');
    const [k] = await sql<{ kapal_id: number; nama_kapal: string }>(
      'select t.kapal_id::int, k.nama_kapal from transaksi_operasional t join kapal k on k.id = t.kapal_id where t.id = $1',
      [t.id]
    );
    expect(k.kapal_id).toBe(r.kapal_id);
    expect(k.nama_kapal).toBe('KM Pindah Baru');
    const [pag] = await sql<{ tanggal: string }>('select tanggal::text from paguyuban where transaksi_id = $1', [t.id]);
    expect(pag.tanggal).toBe('2026-10-03');
  });
});

describe('hapus kegiatan', () => {
  it('menghapus truk, iuran, dan honor telly per kegiatan — tidak tersisa sebagai gaji admin', async () => {
    const [telly] = await sql<{ id: number }>(
      "insert into karyawan (entity_id, nama, jabatan) values ($1, 'Telly Hapus', 'Telly') returning id::int as id",
      [iljId]
    );
    const id = await tambah('KM Hapus Kegiatan');
    const p = await pemilik('P Hapus');
    await rincian(id, [{ nopol: 'UJI 9101', pemilik_id: p, ritase: 1, tonase: 10 }], { telly: telly.id });
    const [t] = await truk(id);

    const { data, error } = await admin.from('operasional_rekap').delete().eq('id', id).select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    expect(await sql('select 1 from transaksi_operasional where id = $1', [t.id])).toHaveLength(0);
    expect(await sql('select 1 from paguyuban where transaksi_id = $1', [t.id])).toHaveLength(0);
    expect(await sql('select 1 from gaji_telly where karyawan_id = $1', [telly.id])).toHaveLength(0);
  });

  it('manajer tidak bisa menghapus kegiatan', async () => {
    const id = await tambah('KM Hapus Manajer');
    const { data } = await manager.from('operasional_rekap').delete().eq('id', id).select('id');
    expect(data ?? []).toHaveLength(0);
    expect(await sql('select 1 from operasional_rekap where id = $1', [id])).toHaveLength(1);
  });
});
