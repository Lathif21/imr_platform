import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { ringkas } from '$lib/operasional/pendapatan';
import { entitasCetak } from '$lib/server/cetak';
import { failLoad } from '$lib/server/operasional';

/**
 * REKAP INCOME — LaporanController::cetakPendapatan.
 *
 * Laravel counted "belum terbayar" here as payment_date empty, while the
 * screen also excluded LUNAS; both now use sudahDibayar(), so the printout
 * and the screen agree.
 */
interface Teks {
  no_invoice: string | null;
  kegiatan: string;
  no_faktur_pajak: string | null;
  no_sto_spo: string | null;
  lokasi: string | null;
  tanggal_kegiatan: string | null;
  tanggal_entry: string | null;
}

type Mentah = Teks & Record<'party_kg' | 'harga' | 'total' | 'pajak' | 'net_tagihan', string> & {
  status_entry: string | null;
  payment_date: string | null;
};

export const load: PageServerLoad = async ({ locals, url }) => {
  const entity = await entitasCetak(locals, url);
  const periode = periodeDari(url);

  const [rows, all] = await Promise.all([
    locals.supabase
      .from('laporan_pendapatan')
      .select('no_invoice, kegiatan, no_faktur_pajak, no_sto_spo, lokasi, tanggal_kegiatan, party_kg, harga, total, pajak, net_tagihan, status_entry, tanggal_entry, payment_date')
      .eq('entity_id', entity.id)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .order('no_urut', { ascending: true, nullsFirst: false })
      .order('id')
      .returns<Mentah[]>(),
    locals.supabase
      .from('laporan_pendapatan')
      .select('party_kg, total, pajak, net_tagihan, status_entry, payment_date')
      .eq('entity_id', entity.id)
      .returns<Partial<Mentah>[]>()
  ]);
  if (rows.error) failLoad('cetak pendapatan', rows.error);
  if (all.error) failLoad('cetak pendapatan all', all.error);

  const angka = (r: Partial<Mentah>) => ({
    party_kg: Number(r.party_kg ?? 0),
    total: Number(r.total ?? 0),
    pajak: Number(r.pajak ?? 0),
    net_tagihan: Number(r.net_tagihan ?? 0),
    status_entry: r.status_entry ?? null,
    payment_date: r.payment_date ?? null
  });

  const baris = (rows.data ?? []).map((r) => ({ ...r, ...angka(r), harga: Number(r.harga ?? 0) }));
  return {
    entity,
    periode,
    baris,
    bulanIni: ringkas(baris).semua,
    keseluruhan: ringkas((all.data ?? []).map(angka))
  };
};
