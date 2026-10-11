/**
 * `src/lib/operasional/kumpulan.ts`. No database.
 *
 * The figures of Kumpulan Laporan, checked against the Laravel formulas they
 * port (buildKumpulanLaporanData).
 */

import { describe, expect, it } from 'vitest';
import { pendapatanKartu, ringkasLabaRugi, susunKumpulan } from '$lib/operasional/kumpulan';

const lunas = (kegiatan: string, rekap: number | null, total: number, pajak: number, party = 10000) => ({
  operasional_rekap_id: rekap,
  kegiatan,
  party_kg: party,
  total,
  pajak,
  status_entry: 'LUNAS',
  payment_date: null
});

describe('susunKumpulan', () => {
  const hasil = susunKumpulan({
    pendapatan: [
      lunas('KM Satu', 1, 1_000_000, 5_000),
      lunas('km satu ', 2, 500_000, 2_500, 5000),
      lunas('KM Dua', null, 300_000, 0),
      { ...lunas('KM Belum', 3, 999_999, 0), status_entry: 'PENDING' }
    ],
    kegiatan: new Map([
      [1, { trips: 4, sangu_supir: 200_000, terpal: 100_000, operasional: 50_000, telly: 'Budi' }],
      [2, { trips: 2, sangu_supir: 80_000, terpal: 0, operasional: 0, telly: 'Ani' }],
      [3, { trips: 9, sangu_supir: 9, terpal: 9, operasional: 9, telly: null }]
    ]),
    gajiTelly: 40_000,
    gajiAdmin: 3_000_000,
    pengeluaran: [
      { jenis: 'Gaji Staff', jumlah: 1_000_000 },
      { jenis: 'Sewa Kantor', jumlah: 2_000_000 },
      { jenis: 'PPh Sewa Kantor', jumlah: 200_000 },
      { jenis: 'Uang Jalan', jumlah: 150_000 },
      { jenis: 'ATK', jumlah: 75_000 }
    ]
  });

  it('hanya invoice lunas; pelayaran kapal yang sama digabung', () => {
    expect(hasil.cards.map((c) => c.kegiatan)).toEqual(['KM Satu', 'KM Dua']);
    const satu = hasil.cards[0];
    expect(satu).toMatchObject({ muatan_mt: 15, ritase: 6, tagihan: 1_500_000, pajak: 7_500, rekanan: 280_000, terpal_50: 50_000, operasional: 50_000, ongkos_pbm: 0 });
    expect(satu.telly).toBe('Budi, Ani');
    expect(pendapatanKartu(satu)).toBe(1_500_000 - 7_500 - 280_000 - 50_000 - 50_000);
  });

  it('invoice tanpa kegiatan: biaya 0, dan dilaporkan', () => {
    expect(hasil.cards[1]).toMatchObject({ rekanan: 0, terpal_50: 0, operasional: 0, ritase: 0 });
    expect(hasil.tanpaKegiatan).toEqual(['KM Dua']);
  });

  it('gaji = honor telly + gaji admin + pengeluaran berjenis gaji (bukan max)', () => {
    expect(hasil.pengeluaran.gaji_karyawan).toBe(40_000 + 3_000_000 + 1_000_000);
  });

  it('pengeluaran lain menurut jenis', () => {
    expect(hasil.pengeluaran).toMatchObject({ sewa_kantor: 2_000_000, pph_sewa_kantor: 200_000, atensi_jalan: 150_000, beban_kantor: 75_000 });
  });

  it('laba rugi', () => {
    const lr = ringkasLabaRugi(hasil.cards, hasil.pengeluaran);
    expect(lr.pendapatan_operasional).toBe(lr.tagihan_wilmar - lr.pajak - lr.rekanan - lr.pbm - lr.terpal_50 - lr.operasional_telly);
    expect(lr.total_pengeluaran).toBe(4_040_000 + 2_000_000 + 200_000 + 150_000 + 75_000);
    expect(lr.pendapatan_bersih).toBe(lr.pendapatan_operasional - lr.total_pengeluaran);
  });
});
