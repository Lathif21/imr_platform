import type { Actions, PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { ringkasLabaRugi, type KartuKapal, type Pengeluaran } from '$lib/operasional/kumpulan';
import { muatKumpulan } from '$lib/server/kumpulan';
import { explainDbError, invalid, refuse, requiredText } from '$lib/server/operasional';

/** Kumpulan Laporan — kumpulanPendapatan, storeKumpulanPendapatan, resetKumpulanPendapatan. */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  if (!opEntity) return { periode, kumpulan: null };
  return { periode, kumpulan: await muatKumpulan(locals.supabase, opEntity.id, periode) };
};

const ANGKA_KARTU = ['muatan_mt', 'ritase', 'tagihan', 'pajak', 'rekanan', 'ongkos_pbm', 'terpal_50', 'operasional'] as const;
const ANGKA_KELUAR = ['gaji_karyawan', 'sewa_kantor', 'pph_sewa_kantor', 'atensi_jalan', 'beban_kantor'] as const;

export const actions: Actions = {
  simpan: async ({ locals, request }) => {
    const form = await request.formData();
    let cards: KartuKapal[];
    let keluar: Pengeluaran;
    try {
      const rawCards = JSON.parse(String(form.get('cards') ?? '[]')) as Record<string, unknown>[];
      const rawKeluar = JSON.parse(String(form.get('pengeluaran') ?? '{}')) as Record<string, unknown>;
      const details: string[] = [];
      cards = rawCards.map((c, i) => {
        const out: Record<string, unknown> = { kegiatan: String(c.kegiatan ?? '').trim(), telly: String(c.telly ?? '').trim() };
        if (out.kegiatan === '') details.push(`Kartu ${i + 1}: nama kapal / kegiatan wajib diisi.`);
        for (const k of ANGKA_KARTU) {
          const n = Number(c[k] ?? 0);
          if (!Number.isFinite(n)) details.push(`Kartu ${i + 1}: ${k} bukan angka.`);
          out[k] = Number.isFinite(n) ? n : 0;
        }
        return out as unknown as KartuKapal;
      });
      keluar = Object.fromEntries(ANGKA_KELUAR.map((k) => [k, Number(rawKeluar[k] ?? 0) || 0])) as unknown as Pengeluaran;
      if (details.length) return invalid(details);
    } catch {
      return refuse('Isian kumpulan laporan tidak terbaca. Muat ulang halaman lalu coba lagi.');
    }

    const summary = ringkasLabaRugi(cards, keluar);
    const { error } = await locals.supabase.from('laporan_kumpulan').upsert(
      {
        entity_id: requiredText(form, 'entity_id'),
        bulan: Number(form.get('bulan')),
        tahun: Number(form.get('tahun')),
        cards_json: cards.map((c) => ({ ...c, pendapatan: c.tagihan - c.pajak - c.rekanan - c.ongkos_pbm - c.terpal_50 - c.operasional })),
        summary_json: summary,
        notes: String(form.get('notes') ?? '').trim() || null
      },
      { onConflict: 'entity_id,bulan,tahun' }
    );
    if (error) return refuse(explainDbError('simpan kumpulan', error, { fallback: 'Kumpulan laporan gagal disimpan.' }));
    return { title: 'Berhasil disimpan', message: 'Data Kumpulan Laporan Operasional & Laba Rugi berhasil disimpan.' };
  },

  reset: async ({ locals, request }) => {
    const form = await request.formData();
    const { error } = await locals.supabase
      .from('laporan_kumpulan')
      .delete()
      .eq('entity_id', requiredText(form, 'entity_id'))
      .eq('bulan', Number(form.get('bulan')))
      .eq('tahun', Number(form.get('tahun')));
    if (error) return refuse(explainDbError('reset kumpulan', error, { fallback: 'Kumpulan laporan gagal direset.' }));
    return { title: 'Berhasil direset', message: 'Kumpulan laporan kembali dihitung otomatis dari data operasional.' };
  }
};
