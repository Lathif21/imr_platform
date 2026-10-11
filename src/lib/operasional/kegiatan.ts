/**
 * Pure helpers for the kegiatan kapal screens (Fase 2): which month is being
 * looked at, how a route is split and rebuilt, and how a typed amount is read.
 * Shared by the server actions and the forms, so both agree on every rule.
 */

export const NAMA_BULAN = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember'
] as const;

export interface Periode {
  bulan: number;
  tahun: number;
}

/** Today's month in Jakarta — the operational system's clock. */
export function bulanIni(now = new Date()): Periode {
  const [tahun, bulan] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit'
  })
    .format(now)
    .split('-')
    .map(Number);
  return { bulan, tahun };
}

/** `?bulan=&tahun=`, clamped like OperasionalController::period(). */
export function periodeDari(url: URL, now = new Date()): Periode {
  const fallback = bulanIni(now);
  const bulan = Number(url.searchParams.get('bulan'));
  const tahun = Number(url.searchParams.get('tahun'));
  return {
    bulan: Number.isInteger(bulan) && bulan >= 1 && bulan <= 12 ? bulan : fallback.bulan,
    tahun: Number.isInteger(tahun) && tahun >= 2020 && tahun <= 2100 ? tahun : fallback.tahun
  };
}

/** `[first day, first day of next month)` as ISO dates, for `tanggal` filters. */
export function rentangBulan({ bulan, tahun }: Periode): { dari: string; sampai: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const next = bulan === 12 ? { bulan: 1, tahun: tahun + 1 } : { bulan: bulan + 1, tahun };
  return {
    dari: `${tahun}-${pad(bulan)}-01`,
    sampai: `${next.tahun}-${pad(next.bulan)}-01`
  };
}

const TANPA_NAMA = ['-', 'kapal/pelabuhan', 'pelabuhan', 'kapal'];

/**
 * A stored route back into its two fields — OperasionalController::editKegiatan.
 * "Kapal/Pelabuhan" is the default destination, so it shows as an empty field.
 */
export function pecahRute(rute: string | null): { asal: string; tujuan: string } {
  const clean = (rute ?? '').replace(/- - ?/g, '').trim();
  let asal = '';
  let tujuan = '';

  if (clean !== '' && clean !== '-') {
    const at = clean.indexOf(' - ');
    if (at >= 0) {
      asal = clean.slice(0, at).trim();
      tujuan = clean.slice(at + 3).trim();
    } else if (/kapal|pelabuhan/i.test(clean)) {
      tujuan = clean;
    } else {
      asal = clean;
    }
  }

  if (TANPA_NAMA.includes(asal.toLowerCase())) asal = '';
  if (TANPA_NAMA.includes(tujuan.toLowerCase())) tujuan = '';
  return { asal, tujuan };
}

/** The two fields into a stored route — OperasionalController::updateKegiatan. */
export function susunRute(asalRaw: string, tujuanRaw: string): string {
  let asal = asalRaw.trim();
  let tujuan = tujuanRaw.trim();
  if (TANPA_NAMA.includes(asal.toLowerCase())) asal = '';
  if (TANPA_NAMA.includes(tujuan.toLowerCase())) tujuan = '';

  if (asal !== '' && tujuan !== '') return `${asal} - ${tujuan}`;
  if (asal !== '') return `${asal} - Kapal/Pelabuhan`;
  if (tujuan !== '') return tujuan;
  return 'Kapal/Pelabuhan';
}

/**
 * A Rupiah amount as typed: "1.250.000", "Rp 1.250.000" or "1250000".
 * Whole rupiah only, as the operational system stored them. `null` when the
 * text holds anything but digits and separators; '' reads as 0.
 */
export function bacaRupiah(raw: string): number | null {
  const text = raw.replace(/^\s*rp\.?\s*/i, '').replace(/[\s.]/g, '');
  if (text === '') return 0;
  return /^\d+$/.test(text) ? Number(text) : null;
}

/**
 * A quantity as typed, Indonesian or not: "12,5", "12.5", "1.250,75".
 * `null` when it is not a non-negative number; '' reads as 0.
 */
export function bacaAngka(raw: string): number | null {
  let text = raw.trim().replace(/\s/g, '');
  if (text === '') return 0;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

/** "12/09/2026", or "12/09/2026 s/d 14/09/2026" for a range — the list column. */
export function rentangTanggal(mulai: string | null, selesai: string | null): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  };
  if (!mulai) return selesai ? `s/d ${fmt(selesai)}` : '—';
  if (selesai && selesai.slice(0, 10) !== mulai.slice(0, 10)) return `${fmt(mulai)} s/d ${fmt(selesai)}`;
  return fmt(mulai);
}

/** "12,5" — tonnage the way the operational screens printed it. */
export function ton(value: string | number | null | undefined): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(value ?? 0));
}
