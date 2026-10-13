/**
 * Lampiran — dokumen asli sebagai bukti. Shared by the upload component and
 * the server routes, so the browser refuses what the server would refuse
 * before a byte is sent. The server checks again; this copy is UX.
 */

export const JENIS_LAMPIRAN = ['kegiatan', 'pendapatan', 'pencairan', 'pengeluaran', 'periode'] as const;
export type JenisLampiran = (typeof JENIS_LAMPIRAN)[number];

export const isJenisLampiran = (v: string): v is JenisLampiran =>
  (JENIS_LAMPIRAN as readonly string[]).includes(v);

/** 20 MB: a scanned multi-page PDF fits, a video does not. */
export const UKURAN_MAKS = 20 * 1024 * 1024;

/** Extension → MIME. The extension decides: phones often send HEIC with an empty type. */
export const TIPE_DITERIMA: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword'
};

export const ACCEPT = Object.keys(TIPE_DITERIMA).map((e) => `.${e}`).join(',');

export function ekstensi(nama: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(nama.trim());
  return m ? m[1].toLowerCase() : '';
}

/** Why this file cannot be attached, or null when it can. */
export function tolakBerkas(nama: string, ukuran: number): string | null {
  if (!TIPE_DITERIMA[ekstensi(nama)]) {
    return `${nama}: jenis berkas tidak diterima. Gunakan PDF, foto (JPG/PNG/HEIC), Excel, Word, atau CSV.`;
  }
  if (ukuran <= 0) return `${nama}: berkas kosong.`;
  if (ukuran > UKURAN_MAKS) return `${nama}: lebih dari 20 MB.`;
  return null;
}

/** Opens in the browser tab rather than downloading. */
export const bisaDilihat = (tipe: string) => tipe === 'application/pdf' || tipe.startsWith('image/');

export function ukuranTeks(byte: number): string {
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${Math.round(byte / 1024)} KB`;
  return `${(byte / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export interface Lampiran {
  id: number;
  nama_file: string;
  tipe: string;
  ukuran: number;
  created_at: string;
  pengunggah: string | null;
}
