/**
 * Lampiran rows. Every read and write goes through the caller's own client,
 * so RLS decides (CLAUDE.md invariant 1): 20250119000000_lampiran.sql.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { JenisLampiran, Lampiran } from '$lib/lampiran';
import type { UserRole } from '$lib/domain';
import { canWriteOperational, canWriteReports } from '$lib/roles';

interface Konfig {
  tabel: 'lampiran_operasional' | 'lampiran_periode';
  /** Column on the lampiran table pointing at the parent. */
  kolom: string;
  induk: string;
  refUuid: boolean;
}

export const KONFIG: Record<JenisLampiran, Konfig> = {
  kegiatan: { tabel: 'lampiran_operasional', kolom: 'operasional_rekap_id', induk: 'operasional_rekap', refUuid: false },
  pendapatan: { tabel: 'lampiran_operasional', kolom: 'laporan_pendapatan_id', induk: 'laporan_pendapatan', refUuid: false },
  pengeluaran: { tabel: 'lampiran_operasional', kolom: 'pengeluaran_id', induk: 'pengeluaran', refUuid: false },
  periode: { tabel: 'lampiran_periode', kolom: 'period_id', induk: 'periods', refUuid: true }
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The parent id as the column expects it, or null when malformed. */
export function bacaRef(jenis: JenisLampiran, raw: unknown): string | number | null {
  const s = String(raw ?? '').trim();
  if (KONFIG[jenis].refUuid) return UUID.test(s) ? s : null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Whether to offer the upload at all. UX only — the insert is what RLS
 * checks. P&L evidence follows can_write_reports(); operational evidence
 * follows can_write_operational().
 */
export function bolehUnggah(role: UserRole | null, jenis: JenisLampiran): boolean {
  if (jenis === 'periode') return canWriteReports(role);
  return canWriteOperational(role);
}

/** The parent's entity, read as the caller — null when they cannot see it. */
export async function entitasInduk(db: SupabaseClient, jenis: JenisLampiran, ref: string | number): Promise<string | null> {
  const { data } = await db
    .from(KONFIG[jenis].induk)
    .select('entity_id')
    .eq('id', ref)
    .maybeSingle<{ entity_id: string }>();
  return data?.entity_id ?? null;
}

export async function daftarLampiran(db: SupabaseClient, jenis: JenisLampiran, ref: string | number): Promise<Lampiran[]> {
  const { tabel, kolom } = KONFIG[jenis];
  const { data, error } = await db
    .from(tabel)
    .select('id, nama_file, tipe, ukuran, created_at, diunggah_oleh')
    .eq(kolom, ref)
    .order('created_at')
    .returns<(Omit<Lampiran, 'pengunggah'> & { diunggah_oleh: string | null })[]>();
  if (error) throw error;
  const rows = data ?? [];

  // Names only where the caller may read profiles; otherwise the list still shows.
  const ids = [...new Set(rows.map((r) => r.diunggah_oleh).filter((x): x is string => !!x))];
  const nama = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await db
      .from('profiles')
      .select('id, full_name')
      .in('id', ids)
      .returns<{ id: string; full_name: string | null }[]>();
    for (const p of profiles ?? []) if (p.full_name) nama.set(p.id, p.full_name);
  }

  return rows.map(({ diunggah_oleh, ...r }) => ({
    ...r,
    ukuran: Number(r.ukuran),
    pengunggah: diunggah_oleh ? (nama.get(diunggah_oleh) ?? null) : null
  }));
}

/** How many files each parent has, for the 📎 count on a list. */
export async function hitungLampiran(
  db: SupabaseClient,
  jenis: JenisLampiran,
  refs: (string | number)[]
): Promise<Record<string, number>> {
  if (refs.length === 0) return {};
  const { tabel, kolom } = KONFIG[jenis];
  const { data } = await db.from(tabel).select(kolom).in(kolom, refs).returns<Record<string, string | number>[]>();
  const hasil: Record<string, number> = {};
  for (const row of data ?? []) {
    const k = String(row[kolom]);
    hasil[k] = (hasil[k] ?? 0) + 1;
  }
  return hasil;
}
