/**
 * Laporan Pendapatan figures, shared by the screen and the printout so both
 * agree. Rules from LaporanController::pendapatan.
 */

/** Status entry options, in the order the document travels. */
export const STATUS_ENTRY = [
  'PENDING',
  'JETTY',
  'ADMIN LAPANGAN',
  'ACCOUNTING',
  'KIRIM PAKET',
  'PROSES PAYMENT',
  'LUNAS'
] as const;

export const TARIF_PAJAK = [0.5, 2, 0] as const;

export interface BarisPendapatan {
  party_kg: number;
  total: number;
  pajak: number;
  net_tagihan: number;
  status_entry: string | null;
  payment_date: string | null;
}

const norm = (s: string | null) => (s ?? '').trim().toUpperCase();

/** Paid: a payment date, or status LUNAS / PAID. */
export function sudahDibayar(row: Pick<BarisPendapatan, 'status_entry' | 'payment_date'>): boolean {
  return row.payment_date !== null || ['LUNAS', 'PAID'].includes(norm(row.status_entry));
}

/**
 * Where an unpaid invoice sits. 'MB AMEL' and 'ADMIN' are old spellings of
 * ADMIN LAPANGAN, and Laravel counted them with JETTY.
 */
export type Posisi = 'PENDING' | 'JETTY' | 'ACCOUNTING' | 'KIRIM PAKET' | 'PROSES PAYMENT' | 'LUNAS' | 'LAIN';

export function posisi(row: Pick<BarisPendapatan, 'status_entry' | 'payment_date'>): Posisi {
  if (sudahDibayar(row)) return 'LUNAS';
  const s = norm(row.status_entry);
  if (s === '' || s === 'PENDING') return 'PENDING';
  if (['JETTY', 'MB AMEL', 'ADMIN LAPANGAN', 'ADMIN'].includes(s)) return 'JETTY';
  if (s === 'ACCOUNTING' || s === 'KIRIM PAKET' || s === 'PROSES PAYMENT') return s;
  return 'LAIN';
}

export interface Jumlah {
  jumlah: number;
  party_kg: number;
  total: number;
  pajak: number;
  net_tagihan: number;
}

const nol = (): Jumlah => ({ jumlah: 0, party_kg: 0, total: 0, pajak: 0, net_tagihan: 0 });

function tambah(acc: Jumlah, row: BarisPendapatan) {
  acc.jumlah += 1;
  acc.party_kg += row.party_kg;
  acc.total += row.total;
  acc.pajak += row.pajak;
  acc.net_tagihan += row.net_tagihan;
}

export function ringkas(rows: BarisPendapatan[]) {
  const semua = nol();
  const belum = nol();
  const sudah = nol();
  const perPosisi = new Map<Posisi, Jumlah>();
  for (const row of rows) {
    tambah(semua, row);
    tambah(sudahDibayar(row) ? sudah : belum, row);
    const p = posisi(row);
    const acc = perPosisi.get(p) ?? nol();
    tambah(acc, row);
    perPosisi.set(p, acc);
  }
  return { semua, belum, sudah, perPosisi };
}
