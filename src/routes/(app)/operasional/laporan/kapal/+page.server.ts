import type { Actions, PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import type { LaporanKapal } from '$lib/operasional/laporan-kapal';
import { muatLaporanKapal, type InvoiceTanpaKegiatan } from '$lib/server/laporan-kapal';
import { explainDbError, idFrom, invalid, optionalText, refuse, requiredText } from '$lib/server/operasional';

/** Laporan per Kapal. The figures come from muatLaporanKapal(), shared with the printout and Excel. */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  if (!opEntity) return { periode, laporan: [] as LaporanKapal[], tanpaKegiatan: [] as InvoiceTanpaKegiatan[] };
  return { periode, ...(await muatLaporanKapal(locals.supabase, opEntity.id, periode)) };
};

export const actions: Actions = {
  /**
   * The voyage in the report's title. Written to every kegiatan of the ship
   * in that month — one table, one statement — because the report is per
   * ship and month, while the column is per kegiatan (20250126).
   */
  voyage: async ({ locals, request }) => {
    const form = await request.formData();
    const kapalId = idFrom(form, 'kapal_id');
    const bulan = Number(form.get('bulan'));
    const tahun = Number(form.get('tahun'));
    const voyage = optionalText(form, 'voyage');

    const details: string[] = [];
    if (kapalId === null) details.push('Kapal tidak dikenali. Muat ulang halaman lalu coba lagi.');
    if (!Number.isInteger(bulan) || bulan < 1 || bulan > 12 || !Number.isInteger(tahun)) details.push('Periode tidak sah.');
    if (voyage !== null && voyage.length > 50) details.push('Voyage maksimal 50 karakter.');
    if (details.length) return invalid(details);

    const { data, error } = await locals.supabase
      .from('operasional_rekap')
      .update({ voyage })
      .eq('entity_id', requiredText(form, 'entity_id'))
      .eq('kapal_id', kapalId!)
      .eq('bulan', bulan)
      .eq('tahun', tahun)
      .select('id');
    if (error) return refuse(explainDbError('update voyage', error, { fallback: 'Voyage gagal disimpan.' }));
    if (!data?.length) return refuse('Kegiatan kapal ini tidak ditemukan, atau Anda tidak berwenang mengubahnya.');
    return {
      title: 'Berhasil disimpan',
      message: voyage ? `Voyage ${voyage} disimpan untuk ${data.length} kegiatan.` : `Voyage dikosongkan untuk ${data.length} kegiatan.`
    };
  }
};
