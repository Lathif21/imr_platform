import { json } from '@sveltejs/kit';
import { canReadOperational } from '$lib/roles';
import { loadOperationalEntities } from '$lib/server/operasional';
import type { RequestHandler } from './$types';

/**
 * Collaboration feed for the operational layout — Laravel's
 * TransaksiOperasionalController::latestActivity, polled by the browser.
 *
 *   GET ?entitas=ILJ            → { kursor }        where to start listening
 *   GET ?entitas=ILJ&setelah=N  → { kursor, aktivitas[] }
 *
 * Starting from "now" rather than the last day, as Laravel did on a first
 * visit, so opening a page does not replay a day of other people's work.
 */
const AKSI: Record<string, string> = { INSERT: 'menambahkan', UPDATE: 'mengubah', DELETE: 'menghapus' };

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!canReadOperational(locals.role)) return json({ kursor: null, aktivitas: [] });
  const db = locals.supabase;

  const setelah = Number(url.searchParams.get('setelah'));
  if (!Number.isInteger(setelah) || setelah < 0 || url.searchParams.get('setelah') === null) {
    const { data } = await db.rpc('kursor_aktivitas');
    return json({ kursor: data ?? null, aktivitas: [] });
  }

  const { selected } = await loadOperationalEntities(db, url.searchParams.get('entitas'));
  if (!selected) return json({ kursor: setelah, aktivitas: [] });

  const { data, error } = await db.rpc('aktivitas_operasional', { p_entity_id: selected.id, p_setelah: setelah });
  if (error) {
    // A feed that fails stays quiet; the next poll tries again.
    console.error('[operasional] aktivitas:', error.code, error.message);
    return json({ kursor: setelah, aktivitas: [] });
  }

  const rows = (data ?? []) as { id: number; waktu: string; pelaku: string; aksi: string; label: string; jumlah: number }[];
  return json({
    kursor: rows.length ? rows[rows.length - 1].id : setelah,
    aktivitas: rows.map((r) => ({
      id: r.id,
      judul: `${r.pelaku} ${AKSI[r.aksi] ?? 'mengubah'} ${r.label}`.trim(),
      jam: new Date(r.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
    }))
  });
};
