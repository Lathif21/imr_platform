/**
 * Ringkasan Eksekutif — the arithmetic and the warnings, with no database in
 * sight so they can be tested on their own. The figures themselves come from
 * $lib/server/ringkasan-operasional (the same function the Dasbor
 * Operasional uses).
 */

import { momPct } from '$lib/format';
import type { Periode } from './kegiatan';

/** Invoice unpaid for longer than this is called out. */
export const PIUTANG_LAMA_HARI = 30;
/** Pengeluaran rising by more than this share month over month is called out. */
export const LONJAKAN_BIAYA = 0.2;
/** No input for this long, in the current month, is called out. */
export const INPUT_BASI_HARI = 7;

export interface AngkaBulan {
  pendapatan: number;
  pajak: number;
  pengeluaran: number;
  bebanRekanan: number;
  laba: number;
  kegiatan: number;
  tonase: number;
}

export interface Piutang {
  nilai: number;
  jumlah: number;
  /** Age of the oldest unpaid invoice, in days. Null when nothing is unpaid. */
  tertuaHari: number | null;
  lama: { nilai: number; jumlah: number };
}

export interface BarisRingkasan {
  code: string;
  nama: string;
  ini: AngkaBulan;
  lalu: AngkaBulan;
  piutang: Piutang;
  /** Latest operational write for this entity, ISO. */
  terakhirInput: string | null;
}

export type Tingkat = 'kritis' | 'perhatian';

export interface Peringatan {
  tingkat: Tingkat;
  code: string;
  teks: string;
}

export const kosong = (a: AngkaBulan) =>
  a.pendapatan === 0 && a.pengeluaran === 0 && a.kegiatan === 0;

/** Laba as a share of revenue, in percent. Null without revenue. */
export function margin(a: AngkaBulan): number | null {
  return a.pendapatan > 0 ? (a.laba / a.pendapatan) * 100 : null;
}

/** Beban rekanan as a share of revenue, in percent — the largest cost driver. */
export function rasioRekanan(a: AngkaBulan): number | null {
  return a.pendapatan > 0 ? (a.bebanRekanan / a.pendapatan) * 100 : null;
}

export function geserBulan({ bulan, tahun }: Periode, langkah: number): Periode {
  const i = tahun * 12 + (bulan - 1) + langkah;
  return { bulan: (i % 12) + 1, tahun: Math.floor(i / 12) };
}

const HARI = 24 * 60 * 60 * 1000;

/**
 * Whole days to `now`, never negative. A bare date (YYYY-MM-DD) counts from
 * Jakarta midnight; a timestamp from its own instant — slicing its date would
 * put a 20:00 UTC write on the wrong Jakarta day.
 */
export function umurHari(tanggal: string, now: Date): number {
  const t = tanggal.length > 10 ? Date.parse(tanggal) : Date.parse(`${tanggal}T00:00:00+07:00`);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / HARI)) : 0;
}

/**
 * Sum across entities. Named "jumlah", never "konsolidasi": an entity that
 * has not input yet, or a sale between two of them, makes it something other
 * than the group's result — the page says which.
 */
export function jumlahkan(rows: AngkaBulan[]): AngkaBulan {
  const total: AngkaBulan = { pendapatan: 0, pajak: 0, pengeluaran: 0, bebanRekanan: 0, laba: 0, kegiatan: 0, tonase: 0 };
  for (const r of rows) for (const k of Object.keys(total) as (keyof AngkaBulan)[]) total[k] += r[k];
  return total;
}

const rp = (v: number) => `Rp ${Math.round(v).toLocaleString('id-ID')}`;

/**
 * What a director should look at first. Only what is wrong; an entity with
 * nothing to report produces nothing. Ordered: critical first, then by entity.
 */
export function peringatan(rows: BarisRingkasan[], opts: { bulanBerjalan: boolean; now: Date }): Peringatan[] {
  const out: Peringatan[] = [];
  for (const r of rows) {
    if (kosong(r.ini)) {
      out.push({ tingkat: 'perhatian', code: r.code, teks: 'Belum ada input operasional bulan ini.' });
    } else if (opts.bulanBerjalan && r.terakhirInput) {
      const hari = umurHari(r.terakhirInput, opts.now);
      if (hari > INPUT_BASI_HARI) {
        out.push({ tingkat: 'perhatian', code: r.code, teks: `Input terakhir ${hari} hari lalu — angka bulan ini mungkin belum lengkap.` });
      }
    }

    if (!kosong(r.ini) && r.ini.laba < 0) {
      out.push({ tingkat: 'kritis', code: r.code, teks: `Rugi ${rp(-r.ini.laba)}: pengeluaran melebihi pendapatan bersih pajak.` });
    }

    if (r.piutang.lama.jumlah > 0) {
      out.push({
        tingkat: r.piutang.tertuaHari !== null && r.piutang.tertuaHari > PIUTANG_LAMA_HARI * 2 ? 'kritis' : 'perhatian',
        code: r.code,
        teks: `${r.piutang.lama.jumlah} invoice belum dibayar lebih dari ${PIUTANG_LAMA_HARI} hari (${rp(r.piutang.lama.nilai)}; tertua ${r.piutang.tertuaHari} hari).`
      });
    }

    const naikBiaya = momPct(r.ini.pengeluaran, r.lalu.pengeluaran);
    const naikPendapatan = momPct(r.ini.pendapatan, r.lalu.pendapatan) ?? 0;
    if (naikBiaya !== null && naikBiaya > LONJAKAN_BIAYA * 100 && naikBiaya > naikPendapatan) {
      out.push({
        tingkat: 'perhatian',
        code: r.code,
        teks: `Pengeluaran naik ${Math.round(naikBiaya)}% dari bulan lalu, pendapatan ${naikPendapatan >= 0 ? 'naik' : 'turun'} ${Math.abs(Math.round(naikPendapatan))}%.`
      });
    }
  }
  return out.sort((a, b) => (a.tingkat === b.tingkat ? a.code.localeCompare(b.code) : a.tingkat === 'kritis' ? -1 : 1));
}
