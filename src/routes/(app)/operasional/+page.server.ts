import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * No operational dashboard yet — that is Fase 5 in docs/PENGGABUNGAN.md. Until
 * then the module opens on Database General, the daily input screen, keeping
 * the chosen entity.
 */
export const load: PageServerLoad = async ({ url }) => {
  redirect(303, `/operasional/general${url.search}`);
};
