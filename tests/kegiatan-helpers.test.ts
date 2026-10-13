/**
 * `src/lib/operasional/kegiatan.ts`. No database.
 *
 * Route parsing and rebuilding follow OperasionalController::editKegiatan and
 * ::updateKegiatan; a mismatch between the two shows up as a route that
 * changes every time the form is saved without being touched.
 */

import { describe, expect, it } from 'vitest';
import {
  bacaAngka,
  bacaRupiah,
  bacaTonase,
  bulanIni,
  pecahRute,
  periodeDari,
  rentangBulan,
  rentangTanggal,
  susunRute,
  ton,
  tonaseSah
} from '$lib/operasional/kegiatan';

describe('rute', () => {
  it.each([
    ['Gudang Veteran - Kapal/Pelabuhan', { asal: 'Gudang Veteran', tujuan: '' }],
    ['KIG - Manyar', { asal: 'KIG', tujuan: 'Manyar' }],
    ['Kapal/Pelabuhan', { asal: '', tujuan: '' }],
    ['- - Kapal/Pelabuhan', { asal: '', tujuan: '' }],
    ['Pabrik Wilmar', { asal: 'Pabrik Wilmar', tujuan: '' }],
    [null, { asal: '', tujuan: '' }]
  ])('pecahRute(%s)', (rute, expected) => {
    expect(pecahRute(rute)).toEqual(expected);
  });

  it.each([
    ['Gudang Veteran', '', 'Gudang Veteran - Kapal/Pelabuhan'],
    ['KIG', 'Manyar', 'KIG - Manyar'],
    ['', 'Manyar', 'Manyar'],
    ['', '', 'Kapal/Pelabuhan'],
    ['-', 'kapal/pelabuhan', 'Kapal/Pelabuhan']
  ])('susunRute(%s, %s)', (asal, tujuan, expected) => {
    expect(susunRute(asal, tujuan)).toBe(expected);
  });

  it('menyimpan tanpa mengubah apa pun menghasilkan rute yang sama', () => {
    for (const rute of ['Gudang Veteran - Kapal/Pelabuhan', 'KIG - Manyar', 'Kapal/Pelabuhan']) {
      const { asal, tujuan } = pecahRute(rute);
      expect(susunRute(asal, tujuan)).toBe(rute);
    }
  });
});

describe('angka', () => {
  it.each([
    ['1.250.000', 1250000],
    ['Rp 1.250.000', 1250000],
    ['1250000', 1250000],
    ['', 0],
    ['12,5', null],
    ['-500', null]
  ])('bacaRupiah(%s)', (raw, expected) => {
    expect(bacaRupiah(raw)).toBe(expected);
  });

  it.each([
    ['12,5', 12.5],
    ['12.5', 12.5],
    ['1.250,75', 1250.75],
    ['', 0],
    ['-1', null],
    ['abc', null]
  ])('bacaAngka(%s)', (raw, expected) => {
    expect(bacaAngka(raw)).toBe(expected);
  });

  it.each([
    ['12,125', 12.125],
    ['12.125', 12.125],
    ['0,001', 0.001],
    ['12', 12],
    ['', 0],
    ['12,1255', null],
    ['abc', null]
  ])('bacaTonase(%s) — paling banyak tiga desimal, tidak dibulatkan', (raw, expected) => {
    expect(bacaTonase(raw)).toBe(expected);
  });

  it('tonaseSah: sisa pecahan dari rumus Excel tidak dianggap desimal keempat', () => {
    expect(tonaseSah(10.1 + 2.2)).toBe(12.3);
    expect(tonaseSah(12.1255)).toBeNull();
  });

  it('ton() menampilkan tiga desimal', () => {
    expect(ton(12.125)).toBe('12,125');
    expect(ton(12.5)).toBe('12,5');
  });
});

describe('periode', () => {
  it('bulan ini menurut jam Jakarta, bukan UTC', () => {
    // 30 September 18:00 UTC = 1 Oktober 01:00 WIB
    expect(bulanIni(new Date('2026-09-30T18:00:00Z'))).toEqual({ bulan: 10, tahun: 2026 });
  });

  it('parameter tidak sah kembali ke bulan ini', () => {
    const now = new Date('2026-10-12T03:00:00Z');
    expect(periodeDari(new URL('http://x/?bulan=13&tahun=abc'), now)).toEqual({ bulan: 10, tahun: 2026 });
    expect(periodeDari(new URL('http://x/?bulan=9&tahun=2026'), now)).toEqual({ bulan: 9, tahun: 2026 });
  });

  it('rentang Desember melewati tahun', () => {
    expect(rentangBulan({ bulan: 12, tahun: 2026 })).toEqual({ dari: '2026-12-01', sampai: '2027-01-01' });
  });

  it('rentang tanggal kegiatan', () => {
    expect(rentangTanggal('2026-09-12', '2026-09-14')).toBe('12/09/2026 s/d 14/09/2026');
    expect(rentangTanggal('2026-09-12', '2026-09-12')).toBe('12/09/2026');
    expect(rentangTanggal(null, null)).toBe('—');
  });
});
