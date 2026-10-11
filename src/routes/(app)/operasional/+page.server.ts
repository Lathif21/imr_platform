import type { PageServerLoad } from './$types';
import { periodeDari, rentangBulan } from '$lib/operasional/kegiatan';
import { ringkas } from '$lib/operasional/pendapatan';
import { muatDetailKegiatan } from '$lib/server/detail-kegiatan';
import { muatGaji } from '$lib/server/gaji';
import { failLoad } from '$lib/server/operasional';
import { muatPartner } from '$lib/server/partner';

/**
 * Dasbor Operasional — DashboardController, in the three parts named in
 * docs/PENGGABUNGAN.md: pendapatan, pengeluaran kotor, pencairan.
 *
 * Laravel's dashboard took transaksi.pendapatan as revenue and showed
 * "Laba Bersih = pendapatan − biaya". That column is the payment to truck
 * owners, so the figure was a cost minus costs (10-integrasi-
 * operasional.md). Here revenue is what is invoiced (Laporan Pendapatan),
 * the truck payment is listed among the costs as Beban Rekanan, and the
 * bottom line is an explicit estimate — the entity's P&L is Laporan P&L.
 */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  if (!opEntity) return { periode, dasbor: null };

  const db = locals.supabase;
  const entityId = opEntity.id;
  const { dari, sampai } = rentangBulan(periode);

  const [kegiatan, gaji, partner, lpResult, trxResult, keluarResult, cairResult, masterResults] = await Promise.all([
    muatDetailKegiatan(db, entityId, periode),
    muatGaji(db, entityId, periode),
    muatPartner(db, entityId, periode),
    db
      .from('laporan_pendapatan')
      .select('party_kg, total, pajak, net_tagihan, status_entry, payment_date')
      .eq('entity_id', entityId)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .returns<Record<string, string | null>[]>(),
    db
      .from('transaksi_operasional')
      .select('id, pendapatan')
      .eq('entity_id', entityId)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .returns<{ id: number; pendapatan: string }[]>(),
    db
      .from('pengeluaran')
      .select('jenis, jumlah')
      .eq('entity_id', entityId)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .returns<{ jenis: string; jumlah: string }[]>(),
    db
      .from('pencairan')
      .select('id, nomor_invoice, kapal_id, nominal_invoice, status')
      .eq('entity_id', entityId)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .order('created_at', { ascending: false })
      .returns<{ id: number; nomor_invoice: string; kapal_id: number; nominal_invoice: string; status: string }[]>(),
    Promise.all(
      (['pemilik', 'kendaraan', 'kapal', 'karyawan'] as const).map((t) =>
        db.from(t).select('id', { count: 'exact', head: true }).eq('entity_id', entityId)
      )
    )
  ]);
  if (lpResult.error) failLoad('dasbor pendapatan', lpResult.error);
  if (trxResult.error) failLoad('dasbor transaksi', trxResult.error);
  if (keluarResult.error) failLoad('dasbor pengeluaran', keluarResult.error);
  if (cairResult.error) failLoad('dasbor pencairan', cairResult.error);

  const trx = trxResult.data ?? [];
  const { data: pag, error: pagError } = await db
    .from('paguyuban')
    .select('total_bayar')
    .in('transaksi_id', trx.map((t) => t.id))
    .returns<{ total_bayar: string }[]>();
  if (pagError) failLoad('dasbor paguyuban', pagError);

  const n = (v: unknown) => Number(v ?? 0) || 0;
  const pendapatan = ringkas(
    (lpResult.data ?? []).map((r) => ({
      party_kg: n(r.party_kg),
      total: n(r.total),
      pajak: n(r.pajak),
      net_tagihan: n(r.net_tagihan),
      status_entry: r.status_entry,
      payment_date: r.payment_date
    }))
  );

  const honorTelly = gaji.ringkas.filter((r) => !r.admin).reduce((s, r) => s + r.gaji_bersih, 0);
  const gajiAdmin = gaji.ringkas.filter((r) => r.admin).reduce((s, r) => s + r.gaji_bersih, 0);
  const pengeluaran = [
    { label: 'Beban rekanan (ongkos angkut)', nilai: trx.reduce((s, t) => s + n(t.pendapatan), 0), href: 'laporan/partner' },
    { label: 'Saku supir', nilai: kegiatan.reduce((s, k) => s + k.sangu_supir, 0), href: 'kegiatan' },
    { label: 'Terpal', nilai: kegiatan.reduce((s, k) => s + k.terpal, 0), href: 'kegiatan' },
    { label: 'Biaya operasional kegiatan', nilai: kegiatan.reduce((s, k) => s + k.operasional, 0), href: 'kegiatan' },
    { label: 'Iuran paguyuban', nilai: (pag ?? []).reduce((s, p) => s + n(p.total_bayar), 0), href: 'laporan/paguyuban' },
    { label: 'Honor telly', nilai: honorTelly, href: 'laporan/gaji' },
    { label: 'Gaji admin', nilai: gajiAdmin, href: 'laporan/gaji' },
    { label: 'Pengeluaran manual', nilai: (keluarResult.data ?? []).reduce((s, p) => s + n(p.jumlah), 0), href: 'pengeluaran' }
  ];
  const totalPengeluaran = pengeluaran.reduce((s, p) => s + p.nilai, 0);

  const cair = cairResult.data ?? [];
  const { data: kapalRows } = await db
    .from('kapal')
    .select('id, nama_kapal')
    .in('id', [...new Set(cair.map((c) => c.kapal_id))])
    .returns<{ id: number; nama_kapal: string }[]>();
  const namaKapal = new Map((kapalRows ?? []).map((k) => [k.id, k.nama_kapal]));
  const [pemilik, kendaraan, kapal, karyawan] = masterResults.map((r) => r.count ?? 0);

  // Ranked lists, as Laravel's "teratas" cards.
  const perKapal = new Map<number, { nama: string; tonase: number; biaya: number }>();
  for (const k of kegiatan) {
    const r = perKapal.get(k.kapal_id) ?? { nama: k.nama_kapal, tonase: 0, biaya: 0 };
    r.tonase += k.tonase;
    r.biaya += k.total;
    perKapal.set(k.kapal_id, r);
  }

  return {
    periode,
    dasbor: {
      ringkas: {
        kegiatan: kegiatan.length,
        truk: kegiatan.reduce((s, k) => s + k.jumlah_truk, 0),
        ritase: kegiatan.reduce((s, k) => s + k.trips, 0),
        tonase: kegiatan.reduce((s, k) => s + k.tonase, 0)
      },
      pendapatan: { semua: pendapatan.semua, belum: pendapatan.belum, sudah: pendapatan.sudah },
      pengeluaran,
      totalPengeluaran,
      selisih: pendapatan.semua.total - pendapatan.semua.pajak - totalPengeluaran,
      pencairan: {
        jumlah: cair.length,
        nominal: cair.reduce((s, c) => s + n(c.nominal_invoice), 0),
        approved: cair.filter((c) => c.status === 'Approved').length,
        pending: cair.filter((c) => c.status === 'Pending').length,
        rejected: cair.filter((c) => c.status === 'Rejected').length,
        daftar: cair.slice(0, 6).map((c) => ({
          id: c.id,
          nomor_invoice: c.nomor_invoice,
          kapal: namaKapal.get(c.kapal_id) ?? '',
          nominal: n(c.nominal_invoice),
          status: c.status
        }))
      },
      master: { pemilik, kendaraan, kapal, karyawan },
      kapalTeratas: [...perKapal.values()].sort((a, b) => b.tonase - a.tonase).slice(0, 5),
      partnerTeratas: partner.ringkas
        .filter((p) => p.pendapatan > 0 || p.biaya > 0)
        .sort((a, b) => b.pendapatan - a.pendapatan)
        .slice(0, 5)
        .map((p) => ({ nama: p.nama, kendaraan: p.kendaraan, dibayar: p.pendapatan, bersih: p.bersih })),
      tellyTeratas: gaji.ringkas
        .filter((r) => !r.admin)
        .sort((a, b) => b.gaji_bersih - a.gaji_bersih)
        .slice(0, 5)
        .map((r) => ({ nama: r.nama, aktivitas: r.aktivitas, bersih: r.gaji_bersih }))
    }
  };
};
