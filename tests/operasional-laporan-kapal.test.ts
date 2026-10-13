/**
 * Laporan per Kapal (migrasi 20250126) — the loader against the real
 * database, under the admin's RLS: the columns it reads exist, invoices come
 * through their kegiatan and not through the ship's name, and the voyage is
 * written the way the screen writes it.
 *
 * The arithmetic itself is in laporan-kapal-helpers.test.ts.
 */

import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bukuLaporan } from '$lib/server/laporan-excel';
import { muatLaporanKapal } from '$lib/server/laporan-kapal';
import { muatPartner } from '$lib/server/partner';
import { closeDb, entityId, resetFixture, signIn, sql } from './helpers';

let admin: SupabaseClient;
let direksi: SupabaseClient;
let iljId: string;
const PERIODE = { bulan: 10, tahun: 2026 };

async function kegiatan(nama: string, rute: string, operasional: number | null, truk: { nopol: string; pemilik_id: number; tonase: number; ritase: number }[]) {
  const { data, error } = await admin.rpc('tambah_kegiatan', {
    p_entity_id: iljId,
    p_nama_kapal: nama,
    p_bulan: PERIODE.bulan,
    p_tahun: PERIODE.tahun,
    p_tanggal_input: null,
    p_tanggal_kegiatan: '2026-10-05',
    p_tanggal_selesai: '2026-10-07',
    p_keterangan: null
  });
  expect(error).toBeNull();
  const id = data as number;
  const { error: e2 } = await admin.rpc('simpan_rincian_kegiatan', {
    p_rekap_id: id,
    p_rute: rute,
    p_operasional: operasional,
    p_telly_id: null,
    p_tanggal_input: null,
    p_tanggal_kegiatan: '2026-10-05',
    p_tanggal_selesai: '2026-10-07',
    p_keterangan: null,
    p_truk: truk
  });
  expect(e2).toBeNull();
  return id;
}

/** Ongkos angkut and saku per truck, through Rincian Pembayaran Truk. */
async function bayar(rekapId: number, ongkos: number, saku: Record<string, number>) {
  const rows = await sql<{ id: number; nopol: string; ritase: number; tonase: string }>(
    `select t.id::int as id, k.nopol, t.ritase, t.tonase from transaksi_operasional t
       join kendaraan k on k.id = t.kendaraan_id where t.operasional_rekap_id = $1`,
    [rekapId]
  );
  const { error } = await admin.rpc('simpan_pembayaran_truk', {
    p_rekap_id: rekapId,
    p_truk: rows.map((r) => ({ id: r.id, ritase: r.ritase, tonase: Number(r.tonase), ongkos_angkut: ongkos, sangu_supir: saku[r.nopol] ?? 0, terpal: 0, paguyuban: null }))
  });
  expect(error).toBeNull();
}

beforeAll(async () => {
  await resetFixture();
  iljId = await entityId('ILJ');
  admin = await signIn('admin.ilj');
  direksi = await signIn('direksi');
});

afterAll(closeDb);

describe('muatLaporanKapal', () => {
  let ali: number;
  let agus: number;
  let inplant: number;

  beforeAll(async () => {
    [{ id: ali }] = await sql<{ id: number }>(`insert into pemilik (entity_id, nama_pemilik) values ($1, 'UJI ALI') returning id::int as id`, [iljId]);
    [{ id: agus }] = await sql<{ id: number }>(
      `insert into pemilik (entity_id, nama_pemilik, rekening_atas_nama, no_rekening, nama_bank)
       values ($1, 'UJI AGUS', 'AGUS SUTRISNO', '7900 874 655', 'BCA') returning id::int as id`,
      [iljId]
    );

    inplant = await kegiatan('UJI KM TIRTA', 'INPLANT - JETTY', 100_000, [
      { nopol: 'UJI 9063 EZ', pemilik_id: ali, tonase: 246, ritase: 10 },
      { nopol: 'UJI 9116 OB', pemilik_id: agus, tonase: 242, ritase: 10 }
    ]);
    await bayar(inplant, 7_370, { 'UJI 9063 EZ': 906_510 });

    // Same ship, second route, biaya operasional left empty.
    const veteran = await kegiatan('UJI KM TIRTA', 'VETERAN - JETTY', null, [{ nopol: 'UJI 9063 EZ', pemilik_id: ali, tonase: 104, ritase: 3 }]);
    await bayar(veteran, 12_100, { 'UJI 9063 EZ': 629_200 });

    // A ship whose name contains the first one's: Laravel's substring match
    // would have handed it the other ship's invoices.
    await kegiatan('UJI KM TIRTA JAYA', 'GUDANG - JETTY', 0, []);

    await sql(`update laporan_pendapatan set no_sto_spo = '8046082837', lokasi = 'INPLANT-JETTY' where operasional_rekap_id = $1`, [inplant]);
    await sql(
      `insert into laporan_pendapatan (entity_id, bulan, tahun, kegiatan, no_invoice, total) values ($1, 10, 2026, 'UJI KM TIRTA manual', 'UJI/MANUAL', 500000)`,
      [iljId]
    );
  });

  it('one report per ship; invoices and trucks through the kegiatan', async () => {
    const { laporan, tanpaKegiatan } = await muatLaporanKapal(admin, iljId, PERIODE);
    expect(laporan.map((l) => l.nama_kapal)).toEqual(['UJI KM TIRTA', 'UJI KM TIRTA JAYA']);

    const [tirta, jaya] = laporan;
    expect(tirta.invoice).toHaveLength(2);
    expect(tirta.invoice[0]).toMatchObject({ rute: 'INPLANT-JETTY', no_spo: '8046082837', tonase: 488 });
    expect(tirta.rute.map((r) => r.rute)).toEqual(['INPLANT-JETTY', 'VETERAN - JETTY']);
    expect(tirta.biaya.operasional).toBe(100_000);
    expect(tirta.biaya.rekanan).toBe((246 + 242) * 7_370 + 104 * 12_100);
    expect(tirta.catatan).toEqual(['Biaya operasional kegiatan VETERAN - JETTY belum diisi (Lengkapi Data); dihitung Rp 0.']);

    expect(tirta.pembayaran.map((p) => [p.nama, p.bruto, p.saku])).toEqual([
      ['UJI ALI', 246 * 7_370 + 104 * 12_100, 906_510 + 629_200],
      ['UJI AGUS', 242 * 7_370, 0]
    ]);
    expect(tirta.pembayaran[1]).toMatchObject({ rekening_atas_nama: 'AGUS SUTRISNO', no_rekening: '7900 874 655', nama_bank: 'BCA' });

    expect(jaya.invoice).toHaveLength(1);
    expect(jaya.pembayaran).toEqual([]);
    expect(tanpaKegiatan).toEqual([{ no_invoice: 'UJI/MANUAL', kegiatan: 'UJI KM TIRTA manual', total: 500_000 }]);
  });

  it('voyage: the admin writes it for every kegiatan of the ship in the month; direksi cannot', async () => {
    const [{ kapal_id }] = await sql<{ kapal_id: number }>('select kapal_id::int as kapal_id from operasional_rekap where id = $1', [inplant]);
    const tulis = (db: SupabaseClient) =>
      db.from('operasional_rekap').update({ voyage: '13' }).eq('entity_id', iljId).eq('kapal_id', kapal_id).eq('bulan', 10).eq('tahun', 2026).select('id');

    const ditolak = await tulis(direksi);
    expect(ditolak.data ?? []).toHaveLength(0);

    const { data, error } = await tulis(admin);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);

    const { laporan } = await muatLaporanKapal(admin, iljId, PERIODE);
    expect(laporan.map((l) => l.voyage)).toEqual(['13', null]);
  });

  it('potongan pajak: the rate typed on Laporan Partner, used by both reports', async () => {
    const simpan = (db: SupabaseClient, pemilik_id: number, persen: number, entity_id = iljId) =>
      db
        .from('pajak_partner')
        .upsert({ entity_id, pemilik_id, bulan: 10, tahun: 2026, persen }, { onConflict: 'pemilik_id,bulan,tahun' })
        .select('id');

    // Nothing typed yet: 0,5%.
    let partner = await muatPartner(admin, iljId, PERIODE);
    const bruto = 246 * 7_370 + 104 * 12_100;
    expect(partner.ringkas.find((p) => p.id === ali)).toMatchObject({ persen_pajak: 0.5, persen_diisi: false, pajak: Math.round(bruto * 0.005) });

    expect((await simpan(direksi, ali, 2)).data ?? []).toHaveLength(0);
    expect((await simpan(admin, ali, 1)).error).toBeNull();
    expect((await simpan(admin, ali, 2)).error).toBeNull(); // second save updates, no duplicate

    partner = await muatPartner(admin, iljId, PERIODE);
    const r = partner.ringkas.find((p) => p.id === ali)!;
    expect(r).toMatchObject({ persen_pajak: 2, persen_diisi: true, pajak: Math.round(bruto * 0.02) });
    expect(r.bersih).toBe(bruto - (906_510 + 629_200) - Math.round(bruto * 0.02));

    const { laporan } = await muatLaporanKapal(admin, iljId, PERIODE);
    expect(laporan[0].pembayaran[0]).toMatchObject({ nama: 'UJI ALI', persen_pajak: 2, pajak: Math.round(bruto * 0.02) });

    // Another month keeps its own (default) rate.
    const nov = await muatPartner(admin, iljId, { bulan: 11, tahun: 2026 });
    expect(nov.ringkas.find((p) => p.id === ali)?.persen_pajak).toBe(0.5);

    // An owner of this entity cannot be filed under another one.
    const amdk = await entityId('AMDK');
    const lintas = await sql(`insert into pajak_partner (entity_id, pemilik_id, bulan, tahun, persen) values ($1, $2, 12, 2026, 1)`, [amdk, ali]).then(
      () => 'masuk',
      (e: { code: string }) => e.code
    );
    expect(lintas).toBe('23503');
  });

  it('Excel: one sheet per ship, figures as numbers', async () => {
    const isi = await bukuLaporan({ db: admin, entityId: iljId, periode: PERIODE }, 'PT Indo Moda Raya', ['kapal']);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(isi as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['UJI KM TIRTA', 'UJI KM TIRTA JAYA']);
    const ws = wb.getWorksheet('UJI KM TIRTA')!;
    expect(String(ws.getCell(1, 1).value)).toBe('RINCIAN KEGIATAN OPERASIONAL — UJI KM TIRTA VOY. 13');
    const angka: number[] = [];
    ws.eachRow((r) => r.eachCell((c) => typeof c.value === 'number' && angka.push(c.value)));
    expect(angka).toContain((246 + 242) * 7_370 + 104 * 12_100);
  });
});
