/**
 * Potongan pajak on what a truck owner (rekanan) is paid. One rate per owner
 * per month, typed on Laporan Partner (pajak_partner, 20250127); the nominal
 * is always computed here, never stored. Laporan Partner and Laporan per
 * Kapal both deduct through this file, so they cannot disagree on the rate
 * or the rounding.
 */

/** Rate of a month nobody has typed one for: the 0,5% of the user's sheets. */
export const TARIF_PAJAK_REKANAN = 0.5;

/**
 * Nominal pajak, whole rupiah. The rate is taken in hundredths of a percent
 * as an integer first, so 2.945.140 × 0,5% is 14.726 and not 14.725,699….
 */
export function pajakRekanan(bruto: number, persen: number = TARIF_PAJAK_REKANAN): number {
  return Math.round((bruto * Math.round(persen * 100)) / 10000);
}

/**
 * A percentage as typed: "0,5", "0.5", "2", "1,75 %". `null` unless it is a
 * number from 0 to 100 with at most two decimals — the column is numeric(5,2),
 * and a rate the database would round is a rate nobody typed.
 */
export function bacaPersen(raw: string): number | null {
  const text = raw.trim().replace(/\s*%$/, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text);
  return n <= 100 ? n : null;
}

/** "0,5%", "2%", "1,75%". */
export function labelPersen(persen: number): string {
  return `${persen.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
}
