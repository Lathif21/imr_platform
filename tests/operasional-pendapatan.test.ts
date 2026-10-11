/**
 * Fase 4a — Laporan Pendapatan (migrasi 20250115).
 *
 * Rumus Laravel: party = tonase × 1.000; total = party/1.000 × harga
 * (34.500); pajak = total × tarif% (0,5); invoice "n/PT.IMR-ROMAWI/tahun".
 * Ditambah perbaikannya: tautan per kegiatan (bukan substring nama), baris
 * yang sudah dibayar tidak disentuh, tarif 0% bertahan, nomor invoice yang
 * diganti ikut di pencairan.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { amount, closeDb, entityId, resetFixture, signIn, sql } from './helpers';

let admin: SupabaseClient;
let manager: SupabaseClient;
let iljId: string;

async function kegiatan(nama: string, tonase: number, bulan = 11): Promise<number> {
  const { data, error } = await admin.rpc('tambah_kegiatan', {
    p_entity_id: iljId,
    p_nama_kapal: nama,
    p_bulan: bulan,
    p_tahun: 2026,
    p_tanggal_input: null,
    p_tanggal_kegiatan: `2026-${String(bulan).padStart(2, '0')}-05`,
    p_tanggal_selesai: `2026-${String(bulan).padStart(2, '0')}-07`,
    p_keterangan: null
  });
  expect(error).toBeNull();
  const id = data as number;
  if (tonase > 0) {
    const [p] = await sql<{ id: number }>("insert into pemilik (entity_id, nama_pemilik) values ($1, $2) returning id::int as id", [iljId, `P ${nama}`]);
    const { error: e2 } = await admin.rpc('simpan_rincian_kegiatan', {
      p_rekap_id: id,
      p_rute: 'Gudang Veteran - Kapal/Pelabuhan',
      p_operasional: 0,
      p_telly_id: null,
      p_tanggal_input: null,
      p_tanggal_kegiatan: `2026-${String(bulan).padStart(2, '0')}-05`,
      p_tanggal_selesai: `2026-${String(bulan).padStart(2, '0')}-07`,
      p_keterangan: null,
      p_truk: [{ nopol: `UJI ${nama.toUpperCase()}`, pemilik_id: p.id, ritase: 1, tonase }]
    });
    expect(e2).toBeNull();
  }
  return id;
}

interface Lp {
  id: number;
  no_urut: number;
  no_invoice: string;
  kegiatan: string;
  lokasi: string;
  tanggal_kegiatan: string;
  party_kg: string;
  harga: string;
  total: string;
  tarif_pajak: string;
  pajak: string;
  net_tagihan: string;
  bulan: number;
}

async function lpKegiatan(rekap: number): Promise<Lp | undefined> {
  const [row] = await sql<Lp>('select *, id::int as id from laporan_pendapatan where operasional_rekap_id = $1', [rekap]);
  return row;
}

beforeAll(async () => {
  await resetFixture();
  iljId = await entityId('ILJ');
  admin = await signIn('admin.ilj');
  manager = await signIn('manajer');
});

afterAll(closeDb);

describe('kegiatan → pendapatan', () => {
  it('kegiatan baru langsung punya baris pendapatan dengan default Laravel', async () => {
    const id = await kegiatan('KM Pendapatan Satu', 10.5);
    const lp = await lpKegiatan(id);
    expect(lp).toMatchObject({
      no_urut: 1,
      no_invoice: '1/PT.IMR-XI/2026',
      kegiatan: 'KM Pendapatan Satu',
      lokasi: 'Gudang Veteran - Kapal/Pelabuhan',
      tanggal_kegiatan: '05 s/d 07 November 2026'
    });
    expect(amount(lp!.party_kg)).toBe(10500);
    expect(amount(lp!.total)).toBe(362250);
    expect(amount(lp!.pajak)).toBe(1811.25);
    expect(amount(lp!.net_tagihan)).toBe(360438.75);
  });

  it('tonase berubah → party dan tagihan ikut, dengan harga dan tarif yang sudah diubah admin', async () => {
    const id = await kegiatan('KM Pendapatan Ubah', 10);
    const lp = (await lpKegiatan(id))!;
    await sql('update laporan_pendapatan set harga = 40000, tarif_pajak = 0 where id = $1', [lp.id]);

    const [t] = await sql<{ id: number }>('select id::int from transaksi_operasional where operasional_rekap_id = $1', [id]);
    await admin.rpc('simpan_pembayaran_truk', {
      p_rekap_id: id,
      p_truk: [{ id: t.id, ritase: 1, tonase: 20, ongkos_angkut: 0, sangu_supir: 0, terpal: 0 }]
    });

    const after = (await lpKegiatan(id))!;
    expect(amount(after.party_kg)).toBe(20000);
    expect(amount(after.total)).toBe(800000);
    // PERBAIKAN: tarif 0% yang dipilih tidak kembali ke 0,5%.
    expect(amount(after.tarif_pajak)).toBe(0);
    expect(amount(after.pajak)).toBe(0);
  });

  it('PERBAIKAN: baris yang sudah dibayar tidak diubah sinkron kegiatan', async () => {
    const id = await kegiatan('KM Pendapatan Lunas', 10);
    const lp = (await lpKegiatan(id))!;
    await sql("update laporan_pendapatan set status_entry = 'LUNAS' where id = $1", [lp.id]);
    const [t] = await sql<{ id: number }>('select id::int from transaksi_operasional where operasional_rekap_id = $1', [id]);
    await admin.rpc('simpan_pembayaran_truk', {
      p_rekap_id: id,
      p_truk: [{ id: t.id, ritase: 1, tonase: 99, ongkos_angkut: 0, sangu_supir: 0, terpal: 0 }]
    });
    expect(amount((await lpKegiatan(id))!.party_kg)).toBe(10000);
  });

  it('PERBAIKAN: kapal bernama mirip tidak saling menimpa', async () => {
    const a = await kegiatan('KM Sinar', 5);
    const b = await kegiatan('KM Sinar Jaya', 7);
    const la = (await lpKegiatan(a))!;
    const lb = (await lpKegiatan(b))!;
    expect(la.id).not.toBe(lb.id);
    expect(amount(la.party_kg)).toBe(5000);
    expect(amount(lb.party_kg)).toBe(7000);
  });

  it('baris lama tanpa tautan dengan nama kapal sama persis diambil alih, bukan diduplikasi', async () => {
    const [legacy] = await sql<{ id: number }>(
      `insert into laporan_pendapatan (entity_id, bulan, tahun, no_urut, no_invoice, kegiatan, party_kg, harga, total)
       values ($1, 12, 2026, 7, 'LAMA-1', 'km  warisan', 0, 34500, 0) returning id::int as id`,
      [iljId]
    );
    const id = await kegiatan('KM Warisan', 3, 12);
    const lp = (await lpKegiatan(id))!;
    expect(lp.id).toBe(legacy.id);
    expect(lp.no_invoice).toBe('LAMA-1');
    expect(amount(lp.party_kg)).toBe(3000);
  });

  it('kegiatan dipindah bulan → pendapatan ikut, mendapat nomor urut berikutnya di bulan baru', async () => {
    const id = await kegiatan('KM Pendapatan Pindah', 4, 11);
    await admin.rpc('ubah_kegiatan', {
      p_rekap_id: id, p_nama_kapal: 'KM Pendapatan Pindah', p_bulan: 10, p_tahun: 2026,
      p_tanggal_input: null, p_tanggal_kegiatan: '2026-10-03', p_tanggal_selesai: null
    });
    const lp = (await lpKegiatan(id))!;
    expect(lp.bulan).toBe(10);
  });

  it('hapus kegiatan menghapus pendapatannya yang belum dibayar; yang punya pencairan tetap', async () => {
    const bebas = await kegiatan('KM Hapus Bebas', 2);
    const lpBebas = (await lpKegiatan(bebas))!;
    await admin.from('operasional_rekap').delete().eq('id', bebas);
    expect(await sql('select 1 from laporan_pendapatan where id = $1', [lpBebas.id])).toHaveLength(0);

    const terikat = await kegiatan('KM Hapus Terikat', 2);
    const lpTerikat = (await lpKegiatan(terikat))!;
    const [k] = await sql<{ id: number }>('select kapal_id::int as id from operasional_rekap where id = $1', [terikat]);
    await admin.rpc('simpan_pencairan', {
      p_entity_id: iljId, p_id: null, p_kapal_id: k.id, p_bulan: 11, p_tahun: 2026,
      p_nomor: lpTerikat.no_invoice, p_nominal: 69000, p_pajak: 345
    });
    await admin.from('operasional_rekap').delete().eq('id', terikat);
    const sisa = await sql<{ operasional_rekap_id: number | null }>('select operasional_rekap_id from laporan_pendapatan where id = $1', [lpTerikat.id]);
    expect(sisa).toHaveLength(1);
    expect(sisa[0].operasional_rekap_id).toBeNull();
  });
});

describe('aksi layar pendapatan', () => {
  it('tambah manual: invoice kosong diisi otomatis, total dihitung', async () => {
    const { data, error } = await admin.rpc('tambah_pendapatan', {
      p_entity_id: iljId, p_bulan: 1, p_tahun: 2027,
      p_data: { kegiatan: 'Manual Satu', party_kg: '2000', harga: '30000', tarif_pajak: '2' }
    });
    expect(error).toBeNull();
    const [lp] = await sql<Lp>('select * from laporan_pendapatan where id = $1', [data]);
    expect(lp.no_invoice).toBe('1/PT.IMR-I/2027');
    expect(amount(lp.total)).toBe(60000);
    expect(amount(lp.pajak)).toBe(1200);
  });

  it('simpan massal menghitung ulang; tanggal bayar kosong mengosongkan', async () => {
    const { data: id } = await admin.rpc('tambah_pendapatan', {
      p_entity_id: iljId, p_bulan: 1, p_tahun: 2027,
      p_data: { kegiatan: 'Manual Dua', party_kg: '1000', harga: '10000', payment_date: '2027-01-20' }
    });
    const { error } = await admin.rpc('simpan_pendapatan_massal', {
      p_rows: [{ id, party_kg: '3000', harga: '10000', tarif_pajak: '0.5', status_entry: 'ACCOUNTING', payment_date: '' }]
    });
    expect(error).toBeNull();
    const [lp] = await sql<Lp & { status_entry: string; payment_date: string | null }>('select * from laporan_pendapatan where id = $1', [id]);
    expect(amount(lp.total)).toBe(30000);
    expect(lp.status_entry).toBe('ACCOUNTING');
    expect(lp.payment_date).toBeNull();
  });

  it('PERBAIKAN: ganti nomor invoice ikut mengganti pencairan; nominal pencairan ikut total', async () => {
    const [k] = await sql<{ id: number }>("insert into kapal (entity_id, nama_kapal) values ($1, 'KM Ganti Invoice') returning id::int as id", [iljId]);
    await admin.rpc('simpan_pencairan', {
      p_entity_id: iljId, p_id: null, p_kapal_id: k.id, p_bulan: 2, p_tahun: 2027,
      p_nomor: 'INV-GANTI-LAMA', p_nominal: 100000, p_pajak: 500
    });
    const [lp] = await sql<{ id: number }>("select id::int from laporan_pendapatan where no_invoice = 'INV-GANTI-LAMA'");
    const { error } = await admin.rpc('simpan_pendapatan_massal', {
      p_rows: [{ id: lp.id, no_invoice: 'INV-GANTI-BARU', party_kg: '4000', harga: '50000', tarif_pajak: '0.5' }]
    });
    expect(error).toBeNull();
    const [p] = await sql<{ nomor_invoice: string; nominal_invoice: string; besaran_pajak: string }>(
      'select nomor_invoice, nominal_invoice, besaran_pajak from pencairan where kapal_id = $1',
      [k.id]
    );
    expect(p.nomor_invoice).toBe('INV-GANTI-BARU');
    expect(amount(p.nominal_invoice)).toBe(200000);
    expect(amount(p.besaran_pajak)).toBe(1000);
  });

  it('rapikan nomor: 1..n, invoice otomatis mengikuti, invoice manual dan yang lunas tetap', async () => {
    const ins = (no: number, inv: string, status: string | null = null) =>
      sql(
        `insert into laporan_pendapatan (entity_id, bulan, tahun, no_urut, no_invoice, kegiatan, status_entry)
         values ($1, 3, 2027, $2, $3, 'R', $4)`,
        [iljId, no, inv, status]
      );
    await ins(4, '4/PT.IMR-III/2027');
    await ins(9, 'INV-MANUAL');
    await ins(12, '12/PT.IMR-III/2027', 'LUNAS');
    await ins(15, '15/PT.IMR-III/2027');

    const { data, error } = await admin.rpc('rapikan_nomor_pendapatan', { p_entity_id: iljId, p_bulan: 3, p_tahun: 2027 });
    expect(error).toBeNull();
    expect(data).toBe(4);
    const rows = await sql<{ no_urut: number; no_invoice: string }>(
      'select no_urut, no_invoice from laporan_pendapatan where entity_id = $1 and bulan = 3 and tahun = 2027 order by no_urut',
      [iljId]
    );
    expect(rows).toEqual([
      { no_urut: 1, no_invoice: '1/PT.IMR-III/2027' },
      { no_urut: 2, no_invoice: 'INV-MANUAL' },
      { no_urut: 3, no_invoice: '12/PT.IMR-III/2027' },
      { no_urut: 4, no_invoice: '4/PT.IMR-III/2027' }
    ]);
  });

  it('manajer tidak bisa mengubah pendapatan', async () => {
    const { error } = await manager.rpc('tambah_pendapatan', {
      p_entity_id: iljId, p_bulan: 1, p_tahun: 2027, p_data: { kegiatan: 'Manajer', party_kg: '1', harga: '1' }
    });
    expect(error).not.toBeNull();
  });
});

describe('tarik_pencairan', () => {
  it('membuat pencairan untuk invoice yang belum punya; kapal dari kegiatan atau nama persis; sisanya dilewati', async () => {
    const id = await kegiatan('KM Tarik', 6, 4);
    await admin.rpc('tambah_pendapatan', {
      p_entity_id: iljId, p_bulan: 4, p_tahun: 2026,
      p_data: { kegiatan: 'Kapal Tak Dikenal', party_kg: '1000', harga: '1000' }
    });

    const { data, error } = await admin.rpc('tarik_pencairan', { p_entity_id: iljId, p_bulan: 4, p_tahun: 2026 });
    expect(error).toBeNull();
    expect(data.dibuat).toBe(1);
    expect(data.dilewati).toHaveLength(1);

    const lp = (await lpKegiatan(id))!;
    const [p] = await sql<{ id: number; nominal_invoice: string; status: string }>(
      'select id::int, nominal_invoice, status from pencairan where nomor_invoice = $1',
      [lp.no_invoice]
    );
    expect(amount(p.nominal_invoice)).toBe(amount(lp.total));
    expect(p.status).toBe('Pending');
    expect(await sql('select 1 from pencairan_approval where pencairan_id = $1', [p.id])).toHaveLength(3);

    const lagi = await admin.rpc('tarik_pencairan', { p_entity_id: iljId, p_bulan: 4, p_tahun: 2026 });
    expect(lagi.data.dibuat).toBe(0);
  });
});
