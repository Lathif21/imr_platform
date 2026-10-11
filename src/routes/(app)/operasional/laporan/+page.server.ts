import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';

/**
 * Laporan — the list of reports (LaporanController::index). Laravel also
 * showed four summary figures here, one of them "pendapatan" that is really
 * the payment to truck owners (10-integrasi-operasional.md); they are not
 * carried over. Each report shows its own figures, under their real names.
 */
export const load: PageServerLoad = async ({ url }) => ({ periode: periodeDari(url) });
