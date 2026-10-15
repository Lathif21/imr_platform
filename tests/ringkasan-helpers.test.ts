import { describe, expect, it } from 'vitest';
import {
  geserBulan,
  jumlahkan,
  margin,
  peringatan,
  rasioRekanan,
  umurHari,
  type AngkaBulan,
  type BarisRingkasan
} from '$lib/operasional/ringkasan';

const angka = (over: Partial<AngkaBulan> = {}): AngkaBulan => ({
  pendapatan: 100_000_000,
  pajak: 500_000,
  pengeluaran: 80_000_000,
  bebanRekanan: 70_000_000,
  laba: 19_500_000,
  kegiatan: 3,
  tonase: 2_000,
  ...over
});

const baris = (over: Partial<BarisRingkasan> = {}): BarisRingkasan => ({
  code: 'ILJ',
  nama: 'PT Indo Moda Raya',
  ini: angka(),
  lalu: angka(),
  piutang: { nilai: 0, jumlah: 0, tertuaHari: null, lama: { nilai: 0, jumlah: 0 } },
  terakhirInput: '2026-10-14T10:00:00Z',
  ...over
});

const NOW = new Date('2026-10-16T05:00:00Z');

describe('ringkasan eksekutif', () => {
  it('margin dan rasio rekanan dari pendapatan; tanpa pendapatan = null', () => {
    expect(margin(angka())).toBeCloseTo(19.5);
    expect(rasioRekanan(angka())).toBeCloseTo(70);
    expect(margin(angka({ pendapatan: 0 }))).toBeNull();
  });

  it('geserBulan melewati batas tahun', () => {
    expect(geserBulan({ bulan: 1, tahun: 2026 }, -1)).toEqual({ bulan: 12, tahun: 2025 });
    expect(geserBulan({ bulan: 11, tahun: 2026 }, 3)).toEqual({ bulan: 2, tahun: 2027 });
  });

  it('umurHari dihitung dalam waktu Jakarta dan tidak pernah negatif', () => {
    expect(umurHari('2026-09-16', NOW)).toBe(30);
    expect(umurHari('2026-12-01', NOW)).toBe(0);
  });

  it('jumlahkan menjumlah setiap angka', () => {
    expect(jumlahkan([angka(), angka({ laba: -500 })]).laba).toBe(19_499_500);
  });

  it('entitas yang sehat tidak menghasilkan peringatan', () => {
    expect(peringatan([baris()], { bulanBerjalan: true, now: NOW })).toEqual([]);
  });

  it('rugi kritis, didahulukan dari yang lain', () => {
    const p = peringatan(
      [
        baris({ code: 'AMDK', ini: angka({ pendapatan: 0, pengeluaran: 0, kegiatan: 0, laba: 0 }) }),
        baris({ code: 'ILJ', ini: angka({ laba: -2_000_000 }) })
      ],
      { bulanBerjalan: true, now: NOW }
    );
    expect(p.map((x) => [x.tingkat, x.code])).toEqual([
      ['kritis', 'ILJ'],
      ['perhatian', 'AMDK']
    ]);
    expect(p[1].teks).toContain('Belum ada input');
  });

  it('input basi hanya diperingatkan pada bulan berjalan', () => {
    const r = baris({ terakhirInput: '2026-10-01T10:00:00Z' });
    expect(peringatan([r], { bulanBerjalan: true, now: NOW })[0].teks).toContain('14 hari lalu');
    expect(peringatan([r], { bulanBerjalan: false, now: NOW })).toEqual([]);
  });

  it('piutang lama; lebih dari dua kali ambang menjadi kritis', () => {
    const lama = { nilai: 5_000_000, jumlah: 2 };
    expect(peringatan([baris({ piutang: { nilai: 9e6, jumlah: 3, tertuaHari: 45, lama } })], { bulanBerjalan: false, now: NOW })[0].tingkat).toBe('perhatian');
    expect(peringatan([baris({ piutang: { nilai: 9e6, jumlah: 3, tertuaHari: 75, lama } })], { bulanBerjalan: false, now: NOW })[0].tingkat).toBe('kritis');
  });

  it('lonjakan biaya hanya bila lebih cepat dari pendapatan', () => {
    const naik = baris({ ini: angka({ pengeluaran: 100_000_000, laba: 0 }), lalu: angka() });
    expect(peringatan([naik], { bulanBerjalan: false, now: NOW })[0].teks).toContain('Pengeluaran naik 25%');

    const ikutNaik = baris({
      ini: angka({ pengeluaran: 100_000_000, pendapatan: 130_000_000 }),
      lalu: angka()
    });
    expect(peringatan([ikutNaik], { bulanBerjalan: false, now: NOW })).toEqual([]);
  });
});
