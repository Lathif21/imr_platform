/**
 * Impor Excel — shared between the upload dialog and the server route.
 * Flow: download the template → fill it → upload → preview (every row checked,
 * duplicates flagged) → save all or nothing.
 */

export const JENIS_IMPOR = ['pengeluaran', 'kegiatan', 'pendapatan', 'pemilik', 'kendaraan', 'kapal', 'karyawan'] as const;
export type JenisImpor = (typeof JENIS_IMPOR)[number];
export const isJenisImpor = (v: string): v is JenisImpor => (JENIS_IMPOR as readonly string[]).includes(v);

/** Which to keep when a row matches data already in the system. */
export type PilihanDuplikat = 'lama' | 'baru';

export interface BarisPratinjau {
  /** Excel row number, as the admin sees it in the file. */
  baris: number;
  tampil: string[];
  galat: string[];
  /** Matches existing data: the admin chooses old or new. */
  duplikat?: { keterangan: string; bisaTimpa: boolean };
  /** Kegiatan only: rows after the first of a kegiatan point to its first row. */
  ikutBaris?: number;
}

export interface Pratinjau {
  jenis: JenisImpor;
  label: string;
  kolom: string[];
  baris: BarisPratinjau[];
  /** Error not tied to one row: wrong template, missing column, empty file. */
  galatBerkas: string[];
}

/** Below Vercel's ~4.5 MB request cap, and far above any real template. */
export const UKURAN_IMPOR_MAKS = 4 * 1024 * 1024;
