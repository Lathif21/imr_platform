import type { PageServerLoad } from './$types';
import { periodeDari, rentangBulan } from '$lib/operasional/kegiatan';
import { failLoad } from '$lib/server/operasional';

/**
 * Laporan Keuangan — LaporanController::keuangan: the month's truck rows and
 * manual expenses, nothing more. Laravel's controller used to compute a
 * "laba bersih" from transaksi.pendapatan, which is a payment to truck owners;
 * it was already removed there and is not ported (10-integrasi-operasional.md).
 *
 * Biaya lapangan per truck as TransaksiOperasional::total_biaya: saku +
 * terpal + operasional + honor telly of that truck + iuran paguyuban.
 */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  const kosong = {
    periode,
    transaksi: [] as { id: number; tanggal: string; kapal: string; nopol: string; rekanan: number; biaya: number }[],
    pengeluaran: [] as { id: number; tanggal: string; jenis: string; nama_kegiatan: string | null; penerima: string | null; jumlah: number }[]
  };
  if (!opEntity) return kosong;

  const db = locals.supabase;
  const { dari, sampai } = rentangBulan(periode);
  const [trxResult, keluarResult, kapalResult, kendaraanResult] = await Promise.all([
    db
      .from('transaksi_operasional')
      .select('id, tanggal, kapal_id, kendaraan_id, pendapatan, sangu_supir, terpal, operasional')
      .eq('entity_id', opEntity.id)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .order('tanggal')
      .order('id')
      .returns<{ id: number; tanggal: string; kapal_id: number; kendaraan_id: number | null; pendapatan: string; sangu_supir: string; terpal: string; operasional: string }[]>(),
    db
      .from('pengeluaran')
      .select('id, tanggal, jenis, nama_kegiatan, penerima, jumlah')
      .eq('entity_id', opEntity.id)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .order('tanggal')
      .returns<{ id: number; tanggal: string; jenis: string; nama_kegiatan: string | null; penerima: string | null; jumlah: string }[]>(),
    db.from('kapal').select('id, nama_kapal').eq('entity_id', opEntity.id).returns<{ id: number; nama_kapal: string }[]>(),
    db.from('kendaraan').select('id, nopol').eq('entity_id', opEntity.id).returns<{ id: number; nopol: string }[]>()
  ]);
  if (trxResult.error) failLoad('keuangan transaksi', trxResult.error);
  if (keluarResult.error) failLoad('keuangan pengeluaran', keluarResult.error);
  if (kapalResult.error) failLoad('keuangan kapal', kapalResult.error);
  if (kendaraanResult.error) failLoad('keuangan kendaraan', kendaraanResult.error);

  const trx = trxResult.data ?? [];
  const ids = trx.map((t) => t.id);
  const [pagResult, gajiResult] = await Promise.all([
    db.from('paguyuban').select('transaksi_id, total_bayar').in('transaksi_id', ids).returns<{ transaksi_id: number; total_bayar: string }[]>(),
    db.from('gaji_telly').select('transaksi_id, gaji_bersih').in('transaksi_id', ids).returns<{ transaksi_id: number; gaji_bersih: string }[]>()
  ]);
  if (pagResult.error) failLoad('keuangan paguyuban', pagResult.error);
  if (gajiResult.error) failLoad('keuangan gaji', gajiResult.error);

  const kapal = new Map((kapalResult.data ?? []).map((k) => [k.id, k.nama_kapal]));
  const nopol = new Map((kendaraanResult.data ?? []).map((k) => [k.id, k.nopol]));
  const pag = new Map((pagResult.data ?? []).map((p) => [p.transaksi_id, Number(p.total_bayar)]));
  const gaji = new Map((gajiResult.data ?? []).map((g) => [g.transaksi_id, Number(g.gaji_bersih)]));

  return {
    periode,
    transaksi: trx.map((t) => ({
      id: t.id,
      tanggal: t.tanggal,
      kapal: kapal.get(t.kapal_id) ?? '—',
      nopol: t.kendaraan_id === null ? '—' : (nopol.get(t.kendaraan_id) ?? '—'),
      rekanan: Number(t.pendapatan),
      biaya: Number(t.sangu_supir) + Number(t.terpal) + Number(t.operasional) + (gaji.get(t.id) ?? 0) + (pag.get(t.id) ?? 0)
    })),
    pengeluaran: (keluarResult.data ?? []).map((p) => ({ ...p, jumlah: Number(p.jumlah) }))
  };
};
