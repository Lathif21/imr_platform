/**
 * Reads one month for Laporan per Kapal and hands it to susunLaporanKapal().
 * The screen, the printout and the Excel export all load through here.
 *
 * Invoices belong to a ship through their kegiatan (laporan_pendapatan.
 * operasional_rekap_id), never by matching the ship's name — the substring
 * match Laravel used put "KM Sinar" invoices on "KM Sinar Jaya". Invoices of
 * the month without that link are returned separately, so the screen can say
 * they are in no ship's report.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Periode } from '$lib/operasional/kegiatan';
import { susunLaporanKapal, type LaporanKapal } from '$lib/operasional/laporan-kapal';
import { TARIF_PAJAK_REKANAN } from '$lib/operasional/pajak';
import { failLoad } from './operasional';
import { muatTarifPajak } from './partner';

const n = (v: unknown) => Number(v ?? 0) || 0;

export interface InvoiceTanpaKegiatan {
  no_invoice: string | null;
  kegiatan: string;
  total: number;
}

export async function muatLaporanKapal(
  db: SupabaseClient,
  entityId: string,
  periode: Periode
): Promise<{ laporan: LaporanKapal[]; tanpaKegiatan: InvoiceTanpaKegiatan[] }> {
  const [tarif, rekapResult, kapalResult, kendaraanResult, pemilikResult, lepasResult] = await Promise.all([
    muatTarifPajak(db, entityId, periode),
    db
      .from('operasional_rekap')
      .select('id, kapal_id, rute, voyage, operasional')
      .eq('entity_id', entityId)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .returns<{ id: number; kapal_id: number; rute: string | null; voyage: string | null; operasional: string | null }[]>(),
    db.from('kapal').select('id, nama_kapal').eq('entity_id', entityId).returns<{ id: number; nama_kapal: string }[]>(),
    db.from('kendaraan').select('id, nopol, pemilik_id').eq('entity_id', entityId).returns<{ id: number; nopol: string; pemilik_id: number }[]>(),
    db
      .from('pemilik')
      .select('id, nama_pemilik, rekening_atas_nama, no_rekening, nama_bank')
      .eq('entity_id', entityId)
      .returns<{ id: number; nama_pemilik: string; rekening_atas_nama: string | null; no_rekening: string | null; nama_bank: string | null }[]>(),
    db
      .from('laporan_pendapatan')
      .select('no_invoice, kegiatan, total')
      .eq('entity_id', entityId)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .is('operasional_rekap_id', null)
      .order('no_urut', { ascending: true, nullsFirst: false })
      .returns<{ no_invoice: string | null; kegiatan: string; total: string }[]>()
  ]);
  for (const [k, r] of Object.entries({ rekapResult, kapalResult, kendaraanResult, pemilikResult, lepasResult })) {
    if (r.error) failLoad(`laporan kapal ${k}`, r.error);
  }

  const rekap = rekapResult.data ?? [];
  const ids = rekap.map((r) => r.id);
  const [invoiceResult, trukResult] = await Promise.all([
    db
      .from('laporan_pendapatan')
      .select('operasional_rekap_id, no_urut, no_invoice, no_sto_spo, lokasi, party_kg, harga, total, tarif_pajak, pajak, net_tagihan')
      .eq('entity_id', entityId)
      .in('operasional_rekap_id', ids)
      .returns<Record<string, string | number | null>[]>(),
    db
      .from('transaksi_operasional')
      .select('id, operasional_rekap_id, kendaraan_id, ritase, tonase, ongkos_angkut, pendapatan, sangu_supir, terpal')
      .eq('entity_id', entityId)
      .in('operasional_rekap_id', ids)
      .returns<Record<string, string | number | null>[]>()
  ]);
  if (invoiceResult.error) failLoad('laporan kapal invoice', invoiceResult.error);
  if (trukResult.error) failLoad('laporan kapal truk', trukResult.error);

  const namaKapal = new Map((kapalResult.data ?? []).map((k) => [k.id, k.nama_kapal]));
  const kendaraan = new Map((kendaraanResult.data ?? []).map((k) => [k.id, k]));

  const laporan = susunLaporanKapal({
    kegiatan: rekap.map((r) => ({
      id: r.id,
      kapal_id: r.kapal_id,
      nama_kapal: namaKapal.get(r.kapal_id) ?? '—',
      rute: r.rute,
      voyage: r.voyage,
      operasional: r.operasional === null ? null : n(r.operasional)
    })),
    invoice: (invoiceResult.data ?? []).map((i) => ({
      operasional_rekap_id: n(i.operasional_rekap_id),
      no_urut: i.no_urut === null ? null : n(i.no_urut),
      no_invoice: (i.no_invoice as string | null) ?? null,
      no_sto_spo: (i.no_sto_spo as string | null) ?? null,
      lokasi: (i.lokasi as string | null) ?? null,
      party_kg: n(i.party_kg),
      harga: n(i.harga),
      total: n(i.total),
      tarif_pajak: n(i.tarif_pajak),
      pajak: n(i.pajak),
      net_tagihan: n(i.net_tagihan)
    })),
    truk: (trukResult.data ?? []).map((t) => {
      const k = t.kendaraan_id === null ? undefined : kendaraan.get(n(t.kendaraan_id));
      return {
        id: n(t.id),
        operasional_rekap_id: n(t.operasional_rekap_id),
        nopol: k?.nopol ?? '(tanpa nopol)',
        pemilik_id: k?.pemilik_id ?? null,
        ritase: n(t.ritase),
        tonase: n(t.tonase),
        ongkos_angkut: n(t.ongkos_angkut),
        jumlah: n(t.pendapatan),
        saku: n(t.sangu_supir),
        terpal: n(t.terpal)
      };
    }),
    pemilik: (pemilikResult.data ?? []).map((p) => ({
      id: p.id,
      nama: p.nama_pemilik,
      rekening_atas_nama: p.rekening_atas_nama,
      no_rekening: p.no_rekening,
      nama_bank: p.nama_bank,
      persen_pajak: tarif.get(p.id) ?? TARIF_PAJAK_REKANAN
    }))
  });

  return {
    laporan,
    tanpaKegiatan: (lepasResult.data ?? []).map((i) => ({ no_invoice: i.no_invoice, kegiatan: i.kegiatan, total: n(i.total) }))
  };
}
