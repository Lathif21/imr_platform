/**
 * Kumpulan Laporan Operasional & Laba Rugi — LaporanController::
 * buildKumpulanLaporanData, as a pure function over rows already loaded.
 *
 * Formulas as in Laravel:
 *   - only paid invoices (payment date, or status LUNAS/PAID);
 *   - per ship card: tagihan = total, pajak, rekanan = saku supir of the
 *     kegiatan, ongkos PBM = 0, terpal 50% = terpal × 0,5, operasional of the
 *     kegiatan; pendapatan = tagihan − pajak − rekanan − PBM − terpal 50% −
 *     operasional; voyages of the same ship name are combined into one card;
 *   - gaji karyawan = honor telly + gaji admin + pengeluaran berjenis "gaji".
 *     Laravel wrote max(a, b) but replaced it with a + b whenever both were
 *     non-zero, which makes it a sum in every case;
 *   - other expenses by jenis: sewa (not PPh), PPh sewa, atensi/jalan, and
 *     everything else as beban kantor.
 *
 * Different on purpose (docs/PENGGABUNGAN.md, Fase 4b): an invoice finds its
 * kegiatan by link, not by ship-name substring and then by list position;
 * a missing ritase stays 0 instead of being estimated as muatan ÷ 30.
 */

import { sudahDibayar } from './pendapatan';

export interface KartuKapal {
  kegiatan: string;
  telly: string;
  muatan_mt: number;
  ritase: number;
  tagihan: number;
  pajak: number;
  rekanan: number;
  ongkos_pbm: number;
  terpal_50: number;
  operasional: number;
}

export interface Pengeluaran {
  gaji_karyawan: number;
  sewa_kantor: number;
  pph_sewa_kantor: number;
  atensi_jalan: number;
  beban_kantor: number;
}

export interface MasukanKumpulan {
  pendapatan: {
    operasional_rekap_id: number | null;
    kegiatan: string;
    party_kg: number;
    total: number;
    pajak: number;
    status_entry: string | null;
    payment_date: string | null;
  }[];
  kegiatan: Map<number, { trips: number; sangu_supir: number; terpal: number; operasional: number; telly: string | null }>;
  gajiTelly: number;
  gajiAdmin: number;
  pengeluaran: { jenis: string; jumlah: number }[];
}

export const pendapatanKartu = (c: KartuKapal) =>
  c.tagihan - c.pajak - c.rekanan - c.ongkos_pbm - c.terpal_50 - c.operasional;

export function ringkasLabaRugi(cards: KartuKapal[], keluar: Pengeluaran) {
  const sum = (k: keyof KartuKapal) => cards.reduce((n, c) => n + Number(c[k] || 0), 0);
  const tagihan_wilmar = sum('tagihan');
  const pajak = sum('pajak');
  const rekanan = sum('rekanan');
  const pbm = sum('ongkos_pbm');
  const terpal_50 = sum('terpal_50');
  const operasional_telly = sum('operasional');
  const pendapatan_operasional = tagihan_wilmar - pajak - rekanan - pbm - terpal_50 - operasional_telly;
  const total_pengeluaran =
    keluar.gaji_karyawan + keluar.sewa_kantor + keluar.pph_sewa_kantor + keluar.atensi_jalan + keluar.beban_kantor;
  return {
    tagihan_wilmar,
    pajak,
    rekanan,
    pbm,
    terpal_50,
    operasional_telly,
    pendapatan_operasional,
    ...keluar,
    total_pengeluaran,
    pendapatan_bersih: pendapatan_operasional - total_pengeluaran
  };
}

export function susunKumpulan(m: MasukanKumpulan): { cards: KartuKapal[]; pengeluaran: Pengeluaran; tanpaKegiatan: string[] } {
  const perKapal = new Map<string, KartuKapal & { tellies: Set<string> }>();
  const tanpaKegiatan: string[] = [];

  for (const lp of m.pendapatan.filter(sudahDibayar)) {
    const r = lp.operasional_rekap_id === null ? undefined : m.kegiatan.get(lp.operasional_rekap_id);
    if (!r) tanpaKegiatan.push(lp.kegiatan);
    const key = lp.kegiatan.trim().toLowerCase();
    const card = perKapal.get(key) ?? {
      kegiatan: lp.kegiatan.trim(),
      telly: '',
      tellies: new Set<string>(),
      muatan_mt: 0,
      ritase: 0,
      tagihan: 0,
      pajak: 0,
      rekanan: 0,
      ongkos_pbm: 0,
      terpal_50: 0,
      operasional: 0
    };
    card.muatan_mt += lp.party_kg / 1000;
    card.ritase += r?.trips ?? 0;
    card.tagihan += lp.total;
    card.pajak += lp.pajak;
    card.rekanan += r?.sangu_supir ?? 0;
    card.terpal_50 += (r?.terpal ?? 0) * 0.5;
    card.operasional += r?.operasional ?? 0;
    if (r?.telly) card.tellies.add(r.telly);
    perKapal.set(key, card);
  }

  const cards = [...perKapal.values()].map(({ tellies, ...c }) => ({ ...c, telly: [...tellies].join(', ') }));

  const jenis = (p: { jenis: string }) => p.jenis.toLowerCase();
  const jumlah = (f: (j: string) => boolean) =>
    m.pengeluaran.filter((p) => f(jenis(p))).reduce((n, p) => n + p.jumlah, 0);

  const gajiPengeluaran = jumlah((j) => j.includes('gaji'));
  return {
    cards,
    tanpaKegiatan,
    pengeluaran: {
      gaji_karyawan: m.gajiTelly + m.gajiAdmin + gajiPengeluaran,
      sewa_kantor: jumlah((j) => j.includes('sewa') && !j.includes('pph')),
      pph_sewa_kantor: jumlah((j) => j.includes('pph') && j.includes('sewa')),
      atensi_jalan: jumlah((j) => j.includes('atensi') || j.includes('jalan')),
      beban_kantor: jumlah((j) => !j.includes('gaji') && !j.includes('sewa') && !j.includes('atensi') && !j.includes('jalan'))
    }
  };
}
