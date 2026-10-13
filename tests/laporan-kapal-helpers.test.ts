/**
 * `src/lib/operasional/laporan-kapal.ts`. No database.
 *
 * The figures are the user's own sheets for September 2026, KM SANEI.pdf and
 * TS 28.pdf: every total below is printed there.
 */

import { describe, expect, it } from 'vitest';
import { bacaPersen, labelPersen, pajakRekanan } from '$lib/operasional/pajak';
import {
  judulKapal,
  labelPajakInvoice,
  susunLaporanKapal,
  type InvoiceSumber,
  type TrukSumber
} from '$lib/operasional/laporan-kapal';

const pemilik = [
  { id: 1, nama: 'H. M. ALI BASTHOMI', rekening_atas_nama: null, no_rekening: null, nama_bank: null, persen_pajak: 0.5 },
  { id: 2, nama: 'SUWAJI', rekening_atas_nama: 'SUWAJI', no_rekening: '1592 0100 9184 508', nama_bank: 'BRI', persen_pajak: 0.5 },
  { id: 3, nama: 'AGUS SUTRISNO', rekening_atas_nama: 'AGUS SUTRISNO', no_rekening: '7900 874 655', nama_bank: 'BCA', persen_pajak: 0.5 }
];

let nextId = 1;
const truk = (rekap: number, pemilik_id: number, nopol: string, tonase: number, ritase: number, ongkos: number, saku: number): TrukSumber => ({
  id: nextId++,
  operasional_rekap_id: rekap,
  nopol,
  pemilik_id,
  ritase,
  tonase,
  ongkos_angkut: ongkos,
  jumlah: tonase * ongkos,
  saku,
  terpal: 0
});

const invoice = (rekap: number, no_urut: number, no_invoice: string, spo: string, lokasi: string, ton: number, harga: number, tarif: number, pajak: number): InvoiceSumber => ({
  operasional_rekap_id: rekap,
  no_urut,
  no_invoice,
  no_sto_spo: spo,
  lokasi,
  party_kg: ton * 1000,
  harga,
  total: ton * harga,
  tarif_pajak: tarif,
  pajak,
  net_tagihan: ton * harga - pajak
});

describe('susunLaporanKapal — KM SANEI VOY. 9', () => {
  // Page 2 of the sheet: 21 trucks of Ali Basthomi, 1 of Suwaji, 3 of Agus.
  const ali: [string, number, number, number][] = [
    ['A 9020 TZ', 90, 3, 1_500_000], ['B 9414 SU', 92, 3, 1_535_000], ['B 9640 JU', 60, 2, 1_000_000],
    ['B 9841 UFU', 94, 3, 1_570_000], ['B 9877 PE', 60, 2, 1_000_000], ['B 9931 TO', 90, 3, 1_500_000],
    ['D 9121 BA', 94, 3, 1_570_000], ['D 9266 AD', 92, 3, 1_535_000], ['H 8966 RE', 30, 1, 500_000],
    ['H 9087 CF', 90, 3, 1_500_000], ['H 9088 CF', 60, 2, 1_000_000], ['L 8086 UX', 94, 3, 1_570_000],
    ['L 8128 YO', 90, 3, 1_500_000], ['L 8366 UC', 60, 2, 1_000_000], ['L 8936 VJ', 90, 3, 1_500_000],
    ['L 9272 UO', 90, 3, 1_500_000], ['L 9340 UW', 90, 3, 1_500_000], ['R 8084 IT', 94, 3, 1_570_000],
    ['S 7815 UJ', 90, 3, 1_500_000], ['W 8685 DT', 90, 3, 1_500_000], ['Z 9815 HA', 60, 2, 1_000_000]
  ];
  const [l] = susunLaporanKapal({
    kegiatan: [{ id: 10, kapal_id: 1, nama_kapal: 'KM. SANEI', rute: 'AGRI SADP 2 - JETTY', voyage: '9', operasional: 200_000 }],
    invoice: [invoice(10, 31, '031/PT.IMR-IX/2026', '8046083428', 'AGRI SADP 2-JETTY', 2000, 34_500, 2, 1_380_000)],
    truk: [
      // Entered out of order on purpose: the sheet sorts plates within an owner.
      ...[...ali].reverse().map(([n, t, r, s]) => truk(10, 1, n, t, r, 30_000, s)),
      truk(10, 2, 'D 9745 UA', 60, 2, 30_000, 1_000_000),
      truk(10, 3, 'B 9419 LI', 90, 3, 30_000, 1_500_000),
      truk(10, 3, 'K 9193 RK', 90, 3, 30_000, 1_500_000),
      truk(10, 3, 'W 8940 PT', 60, 2, 30_000, 1_000_000)
    ],
    pemilik
  });

  it('page 1: invoice, biaya, net pendapatan', () => {
    expect(judulKapal(l)).toBe('KM. SANEI VOY. 9');
    expect(l.jumlahInvoice).toEqual({ tonase: 2000, tagihan: 69_000_000, pajak: 1_380_000, pencairan: 67_620_000 });
    expect(labelPajakInvoice(l.invoice)).toBe('PAJAK PPh 21 (2%)');
    expect(l.biaya).toEqual({ operasional: 200_000, pbm: 0, rekanan: 60_000_000, total: 60_200_000 });
    expect(l.net_pendapatan).toBe(7_420_000);
    expect(l.catatan).toEqual([]);
  });

  it('page 2: trucks per owner, plates sorted, totals per owner and route', () => {
    expect(l.rute).toHaveLength(1);
    expect(l.rute[0].no_spo).toBe('8046083428');
    expect(l.rute[0].rute).toBe('AGRI SADP 2-JETTY');
    const [a, s, g] = l.rute[0].pemilik;
    expect(a.nama).toBe('H. M. ALI BASTHOMI');
    expect(a.truk.map((t) => t.nopol)).toEqual(ali.map(([n]) => n));
    expect(a.jumlah).toEqual({ muat: 1700, rit: 56, jumlah: 51_000_000, saku: 28_350_000, terpal: 0 });
    expect(s.jumlah).toEqual({ muat: 60, rit: 2, jumlah: 1_800_000, saku: 1_000_000, terpal: 0 });
    expect(g.jumlah).toEqual({ muat: 240, rit: 8, jumlah: 7_200_000, saku: 4_000_000, terpal: 0 });
    expect(l.jumlahRekanan).toEqual({ muat: 2000, rit: 66, jumlah: 60_000_000, saku: 33_350_000, terpal: 0 });
  });

  it('page 3: pajak 0,5% and net per owner, with the bank account', () => {
    expect(l.pembayaran.map((p) => [p.nama, p.pajak, p.net])).toEqual([
      ['H. M. ALI BASTHOMI', 255_000, 22_395_000],
      ['SUWAJI', 9_000, 791_000],
      ['AGUS SUTRISNO', 36_000, 3_164_000]
    ]);
    expect(l.pembayaran[2]).toMatchObject({ rekening_atas_nama: 'AGUS SUTRISNO', no_rekening: '7900 874 655', nama_bank: 'BCA', persen_pajak: 0.5 });
    expect(l.pembayaran[0].no_rekening).toBeNull();
  });
});

describe('susunLaporanKapal — KM. TIRTA SAMUDRA XXVIII Voy. 13, two routes', () => {
  const [l] = susunLaporanKapal({
    kegiatan: [
      // The veteran kegiatan was created first; its invoice is the second.
      { id: 21, kapal_id: 2, nama_kapal: 'KM. TIRTA SAMUDRA XXVIII', rute: 'VETERAN - JETTY', voyage: '13', operasional: 40_000 },
      { id: 22, kapal_id: 2, nama_kapal: 'KM. TIRTA SAMUDRA XXVIII', rute: 'INPLANT - JETTY', voyage: '13', operasional: 100_000 }
    ],
    invoice: [
      invoice(21, 18, '018/PT.IMR-IX/2026', '8116057653', 'VETERAN-JETTY', 400, 14_800, 2, 118_400),
      invoice(22, 17, '017/PT.IMR-IX/2026', '8046082837', 'INPLANT-JETTY', 1000, 9_500, 2, 190_000)
    ],
    truk: [
      truk(22, 1, 'B 9063 EZ', 246, 10, 7_370, 906_510),
      truk(22, 1, 'H 9087 CF', 240, 10, 7_370, 884_400),
      truk(22, 1, 'W 8685 DT', 272, 11, 7_370, 1_002_320),
      truk(22, 3, 'B 9116 OB', 242, 10, 7_370, 0),
      truk(21, 1, 'B 9063 EZ', 104, 3, 12_100, 629_200),
      truk(21, 1, 'H 9087 CF', 96, 3, 12_100, 580_800),
      truk(21, 1, 'W 8685 DT', 104, 3, 12_100, 629_200),
      truk(21, 3, 'B 9116 OB', 96, 3, 12_100, 0)
    ],
    pemilik
  });

  it('page 1 follows invoice order, totals as printed', () => {
    expect(judulKapal(l)).toBe('KM. TIRTA SAMUDRA XXVIII VOY. 13');
    expect(l.invoice.map((i) => i.no_invoice)).toEqual(['017/PT.IMR-IX/2026', '018/PT.IMR-IX/2026']);
    expect(l.jumlahInvoice).toEqual({ tonase: 1400, tagihan: 15_420_000, pajak: 308_400, pencairan: 15_111_600 });
    expect(l.biaya).toEqual({ operasional: 140_000, pbm: 0, rekanan: 12_210_000, total: 12_350_000 });
    expect(l.net_pendapatan).toBe(2_761_600);
  });

  it('page 2: one block per route, in the same order', () => {
    expect(l.rute.map((r) => [r.rute, r.no_spo, r.jumlah.muat, r.jumlah.rit, r.jumlah.jumlah, r.jumlah.saku])).toEqual([
      ['INPLANT-JETTY', '8046082837', 1000, 41, 7_370_000, 2_793_230],
      ['VETERAN-JETTY', '8116057653', 400, 12, 4_840_000, 1_839_200]
    ]);
    expect(l.jumlahRekanan).toMatchObject({ muat: 1400, rit: 53, jumlah: 12_210_000, saku: 4_632_430 });
  });

  it('page 3: each owner over both routes; pajak rounded once on the total', () => {
    const [ali, agus] = l.pembayaran;
    expect(ali.rute.map((r) => [r.rute, r.muat, r.rit, r.bruto])).toEqual([
      ['INPLANT-JETTY', 758, 31, 5_586_460],
      ['VETERAN-JETTY', 304, 9, 3_678_400]
    ]);
    expect([ali.bruto, ali.saku, ali.pajak, ali.net]).toEqual([9_264_860, 4_632_430, 46_324, 4_586_106]);
    // The sheet prints this owner's routes as 1.000 / 41 and 400 / 12 — the
    // route totals, a copying slip. The owner's own trucks are 242 / 10 and 96 / 3.
    expect(agus.rute.map((r) => [r.muat, r.rit])).toEqual([[242, 10], [96, 3]]);
    expect([agus.bruto, agus.pajak, agus.net]).toEqual([2_945_140, 14_726, 2_930_414]);
  });
});

describe('susunLaporanKapal — gaps are named, not guessed', () => {
  it('kegiatan without an invoice or without biaya operasional', () => {
    const [l] = susunLaporanKapal({
      kegiatan: [{ id: 1, kapal_id: 9, nama_kapal: 'KM Uji', rute: 'GUDANG - JETTY', voyage: null, operasional: null }],
      invoice: [],
      truk: [],
      pemilik: []
    });
    expect(judulKapal(l)).toBe('KM Uji');
    expect(l.biaya.total).toBe(0);
    expect(l.catatan).toEqual([
      'Kegiatan GUDANG - JETTY belum punya invoice di Laporan Pendapatan.',
      'Biaya operasional kegiatan GUDANG - JETTY belum diisi (Lengkapi Data); dihitung Rp 0.'
    ]);
  });

  it('different voyages in one month are both in the title', () => {
    const [l] = susunLaporanKapal({
      kegiatan: [
        { id: 1, kapal_id: 9, nama_kapal: 'KM Uji', rute: null, voyage: '3', operasional: 0 },
        { id: 2, kapal_id: 9, nama_kapal: 'KM Uji', rute: null, voyage: ' 4 ', operasional: 0 },
        { id: 3, kapal_id: 9, nama_kapal: 'KM Uji', rute: null, voyage: '3', operasional: 0 }
      ],
      invoice: [],
      truk: [],
      pemilik: []
    });
    expect(judulKapal(l)).toBe('KM Uji VOY. 3 / 4');
  });

  it('mixed tax rates get no single rate in the label', () => {
    const baris = (tarif_pajak: number) => ({ no_invoice: null, no_spo: null, rute: '-', tonase: 0, harga: 0, tagihan: 0, tarif_pajak, pajak: 0, pencairan: 0 });
    expect(labelPajakInvoice([baris(0.5), baris(2)])).toBe('PAJAK PPh 21');
    expect(labelPajakInvoice([baris(0.5)])).toBe('PAJAK PPh 21 (0,5%)');
  });

  it('pajakRekanan rounds half up to whole rupiah; 0,5% unless a rate is given', () => {
    expect(pajakRekanan(2_945_140)).toBe(14_726);
    expect(pajakRekanan(1_800_000)).toBe(9_000);
    expect(pajakRekanan(0)).toBe(0);
    expect(pajakRekanan(9_264_860, 2)).toBe(185_297);
    expect(pajakRekanan(1_000_001, 1.75)).toBe(17_500);
    expect(pajakRekanan(5_000_000, 0)).toBe(0);
  });

  it("each owner's own rate of the month", () => {
    const [l] = susunLaporanKapal({
      kegiatan: [{ id: 1, kapal_id: 9, nama_kapal: 'KM Uji', rute: 'A - B', voyage: null, operasional: 0 }],
      invoice: [],
      truk: [truk(1, 1, 'B 1', 100, 1, 10_000, 200_000), truk(1, 2, 'B 2', 100, 1, 10_000, 0)],
      pemilik: [
        { ...pemilik[0], persen_pajak: 2 },
        { ...pemilik[1], persen_pajak: 0 }
      ]
    });
    expect(l.pembayaran.map((p) => [p.persen_pajak, p.pajak, p.net])).toEqual([
      [2, 20_000, 780_000],
      [0, 0, 1_000_000]
    ]);
  });
});

describe('bacaPersen / labelPersen', () => {
  it('reads Indonesian and plain decimals, refuses what numeric(5,2) would round', () => {
    expect(bacaPersen('0,5')).toBe(0.5);
    expect(bacaPersen(' 2 % ')).toBe(2);
    expect(bacaPersen('1.75')).toBe(1.75);
    expect(bacaPersen('0')).toBe(0);
    expect(bacaPersen('100')).toBe(100);
    for (const salah of ['', '-1', '100,5', '0,125', 'abc', '1.000,5']) expect(bacaPersen(salah), salah).toBeNull();
  });

  it('labels', () => {
    expect(labelPersen(0.5)).toBe('0,5%');
    expect(labelPersen(2)).toBe('2%');
  });
});
