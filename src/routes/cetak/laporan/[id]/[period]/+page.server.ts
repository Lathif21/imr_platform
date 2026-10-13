import { muatLaporanPnl } from '$lib/server/pnl-laporan';
import type { PageServerLoad } from './$types';

/**
 * The approved P&L on paper — "Simpan sebagai PDF" in the print dialog is the
 * PDF download. Outside the app shell like the operational printouts; the
 * session is required by hooks.server.ts and RLS decides what is readable.
 */
export const load: PageServerLoad = async ({ locals, params }) => ({
  laporan: await muatLaporanPnl(locals.supabase, params.id, params.period)
});
