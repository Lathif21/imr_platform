import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { entitasCetak } from '$lib/server/cetak';
import { failLoad } from '$lib/server/operasional';

/**
 * Berita Acara — LaporanController::cetakBaPendapatan.
 *
 * The telly is read from the kegiatan this row is linked to. Laravel found
 * the kegiatan by a substring of the ship's name, so a BA could name the
 * telly of another ship.
 */
interface Item {
  id: number;
  entity_id: string;
  operasional_rekap_id: number | null;
  bulan: number;
  tahun: number;
  no_urut: number | null;
  no_invoice: string | null;
  kegiatan: string;
  no_faktur_pajak: string | null;
  no_sto_spo: string | null;
  lokasi: string | null;
  tanggal_kegiatan: string | null;
  party_kg: string;
  harga: string;
  total: string;
  tarif_pajak: string;
  pajak: string;
  net_tagihan: string;
}

export const load: PageServerLoad = async ({ locals, url, params }) => {
  const entity = await entitasCetak(locals, url);
  if (!/^\d+$/.test(params.id)) error(404, 'Data pendapatan tidak ditemukan.');

  const { data: item, error: err } = await locals.supabase
    .from('laporan_pendapatan')
    .select('id, entity_id, operasional_rekap_id, bulan, tahun, no_urut, no_invoice, kegiatan, no_faktur_pajak, no_sto_spo, lokasi, tanggal_kegiatan, party_kg, harga, total, tarif_pajak, pajak, net_tagihan')
    .eq('id', Number(params.id))
    .maybeSingle<Item>();
  if (err) failLoad('ba pendapatan', err);
  if (!item || item.entity_id !== entity.id) error(404, 'Data pendapatan tidak ditemukan di entitas ini.');

  let telly = '';
  if (item.operasional_rekap_id !== null) {
    const { data: rekap } = await locals.supabase
      .from('operasional_rekap')
      .select('telly_id')
      .eq('id', item.operasional_rekap_id)
      .maybeSingle<{ telly_id: number | null }>();
    if (rekap?.telly_id) {
      const { data: k } = await locals.supabase.from('karyawan').select('nama').eq('id', rekap.telly_id).maybeSingle<{ nama: string }>();
      telly = k?.nama ?? '';
    }
  }

  const pad = (v: number, w: number) => String(v).padStart(w, '0');
  return {
    entity,
    item: {
      ...item,
      party_kg: Number(item.party_kg),
      harga: Number(item.harga),
      total: Number(item.total),
      tarif_pajak: Number(item.tarif_pajak),
      pajak: Number(item.pajak),
      net_tagihan: Number(item.net_tagihan)
    },
    telly,
    noBa: `BA/IMR/${item.tahun}/${pad(Number(item.bulan), 2)}/${pad(Number(item.no_urut ?? item.id), 3)}`,
    pembuat: locals.fullName ?? 'Admin Operasional'
  };
};
