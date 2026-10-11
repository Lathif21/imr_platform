/**
 * Shared plumbing for the operational screens (`/operasional/*`).
 *
 * Not a repository layer — every screen still calls supabase-js directly
 * (CLAUDE.md). This file only holds the two things every screen would
 * otherwise copy: which entity is being looked at, and how a database refusal
 * is told to the person on the screen.
 */

import { error, fail } from '@sveltejs/kit';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

export interface OperationalEntity {
  id: string;
  code: string;
  legal_name: string;
}

/**
 * Entities this user may see operational data for, and the selected one.
 *
 * Read from `entities`, whose RLS already narrows to the caller: all of them
 * for direksi, the assigned ones for everyone else. The default is the first
 * entity linked to an operational system (`operational_sync_config`), not the
 * first alphabetically — for a director that would be AMDK, an entity with no
 * operational data at all.
 */
export async function loadOperationalEntities(
  supabase: SupabaseClient,
  requestedCode: string | null
): Promise<{ entities: OperationalEntity[]; selected: OperationalEntity | null }> {
  const [entitiesResult, linkedResult] = await Promise.all([
    supabase
      .from('entities')
      .select('id, code, legal_name')
      .eq('is_active', true)
      .order('code')
      .returns<OperationalEntity[]>(),
    supabase.from('operational_sync_config').select('entity_id').returns<{ entity_id: string }[]>()
  ]);

  if (entitiesResult.error) failLoad('entities', entitiesResult.error);
  // A missing link only changes the default; it is not worth failing the page.
  if (linkedResult.error) logError('operational_sync_config', linkedResult.error);

  const entities = entitiesResult.data ?? [];
  const linked = new Set((linkedResult.data ?? []).map((row) => row.entity_id));

  const selected =
    entities.find((entity) => entity.code === requestedCode) ??
    entities.find((entity) => linked.has(entity.id)) ??
    entities[0] ??
    null;

  return { entities, selected };
}

function logError(context: string, cause: PostgrestError) {
  console.error(`[operasional] ${context}:`, cause.code, cause.message, cause.details);
}

export function failLoad(context: string, cause: PostgrestError): never {
  logError(context, cause);
  error(500, 'Gagal memuat data operasional.');
}

/**
 * A database refusal, as a sentence for the error modal.
 *
 * Postgres messages name tables, constraints and policies, so they go to the
 * log and never to the browser — same rule as the report screens. Our own
 * triggers raise `P0001` in Indonesian and pass through. The rest map to what
 * the person can actually do about it.
 */
export function explainDbError(
  context: string,
  cause: PostgrestError,
  messages: { duplicate?: string; fallback: string }
): string {
  logError(context, cause);
  switch (cause.code) {
    case 'P0001':
      return cause.message;
    case '42501':
      return 'Akun Anda tidak berwenang mengubah data operasional entitas ini. Hanya Admin Operasional yang ditugaskan ke entitas ini yang dapat menginput.';
    case '23505':
      return messages.duplicate ?? 'Data yang sama sudah ada.';
    case '23503':
      return 'Data yang dirujuk tidak ditemukan di entitas ini, atau masih dipakai data lain.';
    case 'PGRST202':
      // Fungsi baru belum masuk cache skema Neon Data API. Cache itu tidak
      // mengikuti NOTIFY pgrst; ia diperbarui lewat tombol "Refresh schema
      // cache" di Neon Console (Postgres database → Data API).
      return 'Fitur ini memerlukan pembaruan database yang belum aktif di server. Minta admin sistem menekan "Refresh schema cache" pada Data API di Neon Console.';
    default:
      return messages.fallback;
  }
}

/**
 * Validation result for a form: every problem at once, the way the
 * operational system's "Gagal Menyimpan Data" modal listed every failed field
 * rather than stopping at the first.
 */
export function invalid(details: string[]) {
  return fail(400, {
    message: 'Periksa kembali isian berikut, lalu simpan ulang.',
    details
  });
}

/** A refusal with one sentence, and optionally the reasons behind it. */
export function refuse(message: string, details?: string[]) {
  return fail(400, { message, details });
}

/** Trimmed text, or null when empty — optional columns store NULL, not ''. */
export function optionalText(form: FormData, name: string): string | null {
  const value = String(form.get(name) ?? '').trim();
  return value === '' ? null : value;
}

export function requiredText(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

/** A bigint id from a form field, or null when absent or not a whole number. */
export function idFrom(form: FormData, name = 'id'): number | null {
  const raw = String(form.get(name) ?? '').trim();
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
