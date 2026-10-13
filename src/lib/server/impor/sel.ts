/**
 * Reading one Excel cell the way the manual forms read a field: Indonesian
 * thousands dots and decimal comma, dates as dd/mm/yy(yy) or real date cells.
 * Every reader returns `null` for an empty cell and `undefined` for a value
 * it cannot read, so the checker can say "wajib diisi" and "tidak sah" apart.
 */
import type ExcelJS from 'exceljs';
import { bacaAngka, bacaRupiah } from '$lib/operasional/kegiatan';

/** The cell's value without formulas, rich text or hyperlinks. */
export function mentah(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return (v as ExcelJS.CellFormulaValue).result;
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return (v as ExcelJS.CellHyperlinkValue).text;
  }
  return v;
}

export function teks(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isoTanggal(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

const kosong = (v: unknown) => teks(v) === '';

function isoTanggal(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function sah(y: number, m: number, d: number): string | undefined {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  if (y < 2000 || y > 2100) return undefined;
  return isoTanggal(dt);
}

/** 'YYYY-MM-DD' from a date cell, an Excel serial, dd/mm/yy, dd/mm/yyyy or yyyy-mm-dd. A two-digit year is 20yy. */
export function tanggal(v: unknown): string | null | undefined {
  if (kosong(v)) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? undefined : isoTanggal(v);
  if (typeof v === 'number') return isoTanggal(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000));
  const s = teks(v);
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) return sah(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return sah(+m[1], +m[2], +m[3]);
  return undefined;
}

/** Whole Rupiah, 0 or more. */
export function rupiah(v: unknown): number | null | undefined {
  if (kosong(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
  return bacaRupiah(teks(v)) ?? undefined;
}

/** Decimal 0 or more, e.g. tonase 12,5. */
export function desimal(v: unknown): number | null | undefined {
  if (kosong(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : undefined;
  return bacaAngka(teks(v)) ?? undefined;
}

/** Whole number 0 or more, e.g. ritase. */
export function bulat(v: unknown): number | null | undefined {
  const n = desimal(v);
  if (n === null || n === undefined) return n;
  return Number.isInteger(n) ? n : undefined;
}

/** Same comparison as SQL nama_banding(): case and spacing ignored. */
export const banding = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export const normalNopol = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
