import type { PageServerLoad } from './$types';
import { periodeDari, rentangBulan } from '$lib/operasional/kegiatan';
import { muatDetailKegiatan, type DetailRow } from '$lib/server/detail-kegiatan';
import { failLoad } from '$lib/server/operasional';

/**
 * Laporan Operasional — LaporanController::operasional: a summary per ship
 * and the cost of every kegiatan.
 *
 * Laravel's summary had "Pendapatan" and "Laba = Pendapatan − Biaya", where
 * pendapatan was transaksi.pendapatan — the payment to truck owners. That is
 * a cost, so "laba" subtracted a cost from a cost (10-integrasi-
 * operasional.md). The same figure is shown here as Beban Rekanan among the
 * costs, and there is no laba column; the P&L lives in Laporan P&L.
 * Laravel also took honor telly from per-truck rows only, which no screen
 * creates any more; it is read from the per-kegiatan rows.
 */
export interface RingkasKapal {
  kapal_id: number;
  nama_kapal: string;
  kegiatan: number;
  truk: number;
  ritase: number;
  tonase: number;
  rekanan: number;
  sangu_supir: number;
  terpal: number;
  operasional: number;
  paguyuban: number;
  telly: number;
  total: number;
}

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  if (!opEntity) return { periode, ringkas: [] as RingkasKapal[], kegiatan: [] as DetailRow[] };

  const db = locals.supabase;
  const { dari, sampai } = rentangBulan(periode);
  const kegiatan = await muatDetailKegiatan(db, opEntity.id, periode);

  const { data: trx, error } = await db
    .from('transaksi_operasional')
    .select('id, kapal_id, pendapatan')
    .eq('entity_id', opEntity.id)
    .gte('tanggal', dari)
    .lt('tanggal', sampai)
    .returns<{ id: number; kapal_id: number; pendapatan: string }[]>();
  if (error) failLoad('laporan operasional transaksi', error);

  const [pagResult, tellyResult] = await Promise.all([
    db.from('paguyuban').select('transaksi_id, total_bayar').in('transaksi_id', (trx ?? []).map((t) => t.id)).returns<{ transaksi_id: number; total_bayar: string }[]>(),
    db.from('gaji_telly').select('operasional_rekap_id, gaji_bersih').in('operasional_rekap_id', kegiatan.map((k) => k.id)).returns<{ operasional_rekap_id: number; gaji_bersih: string }[]>()
  ]);
  if (pagResult.error) failLoad('laporan operasional paguyuban', pagResult.error);
  if (tellyResult.error) failLoad('laporan operasional telly', tellyResult.error);

  const kapalTrx = new Map((trx ?? []).map((t) => [t.id, t.kapal_id]));
  const kapalRekap = new Map(kegiatan.map((k) => [k.id, k.kapal_id]));
  const per = new Map<number, RingkasKapal>();
  const ambil = (kapalId: number, nama = '—') => {
    const r =
      per.get(kapalId) ??
      { kapal_id: kapalId, nama_kapal: nama, kegiatan: 0, truk: 0, ritase: 0, tonase: 0, rekanan: 0, sangu_supir: 0, terpal: 0, operasional: 0, paguyuban: 0, telly: 0, total: 0 };
    per.set(kapalId, r);
    return r;
  };

  for (const k of kegiatan) {
    const r = ambil(k.kapal_id, k.nama_kapal);
    r.kegiatan += 1;
    r.truk += k.jumlah_truk;
    r.ritase += k.trips;
    r.tonase += k.tonase;
    r.sangu_supir += k.sangu_supir;
    r.terpal += k.terpal;
    r.operasional += k.operasional;
  }
  for (const t of trx ?? []) ambil(t.kapal_id).rekanan += Number(t.pendapatan);
  for (const p of pagResult.data ?? []) {
    const kapalId = kapalTrx.get(p.transaksi_id);
    if (kapalId !== undefined) ambil(kapalId).paguyuban += Number(p.total_bayar);
  }
  for (const g of tellyResult.data ?? []) {
    const kapalId = kapalRekap.get(g.operasional_rekap_id);
    if (kapalId !== undefined) ambil(kapalId).telly += Number(g.gaji_bersih);
  }
  for (const r of per.values()) r.total = r.rekanan + r.sangu_supir + r.terpal + r.operasional + r.paguyuban + r.telly;

  return {
    periode,
    kegiatan,
    ringkas: [...per.values()].sort((a, b) => a.nama_kapal.localeCompare(b.nama_kapal, 'id'))
  };
};
