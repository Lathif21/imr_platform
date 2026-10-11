import { redirect } from '@sveltejs/kit';
import { canReadOperational, canWriteOperational } from '$lib/roles';
import { loadOperationalEntities } from '$lib/server/operasional';
import type { LayoutServerLoad } from './$types';

/**
 * Every operational screen inherits this. UI shaping, not the boundary: the
 * operational tables refuse reads and writes through can_read_operational()
 * and can_write_operational() in RLS (migrations 20250108, 20250110).
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!canReadOperational(locals.role)) redirect(303, '/');

  const { entities, selected } = await loadOperationalEntities(
    locals.supabase,
    url.searchParams.get('entitas')
  );

  return {
    opEntities: entities,
    opEntity: selected,
    /**
     * Whether to offer the add/edit/delete controls at all. A director, a
     * manager or an auditor reading this screen sees no button that would
     * only ever end in a refusal.
     */
    canWrite: canWriteOperational(locals.role)
  };
};
