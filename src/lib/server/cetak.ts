/**
 * Printouts (`/cetak/operasional/*`) live outside the app shell so the page is
 * only the paper. They still need the same gate as the screens they print
 * from: hooks.server.ts already requires a session; this adds the role and
 * the entity, which the (app)/operasional layout would otherwise supply.
 */

import { error } from '@sveltejs/kit';
import { canReadOperational } from '$lib/roles';
import { loadOperationalEntities, type OperationalEntity } from './operasional';

export async function entitasCetak(locals: App.Locals, url: URL): Promise<OperationalEntity> {
  if (!canReadOperational(locals.role)) error(403, 'Akun Anda tidak berwenang membaca data operasional.');
  const { selected } = await loadOperationalEntities(locals.supabase, url.searchParams.get('entitas'));
  if (!selected) error(404, 'Belum ada entitas yang ditautkan ke akun Anda.');
  return selected;
}
