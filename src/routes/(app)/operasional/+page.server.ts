import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { muatPartner } from '$lib/server/partner';
import { hitungBulan } from '$lib/server/ringkasan-operasional';

/**
 * Dasbor Operasional — DashboardController: pendapatan and pengeluaran
 * kotor (docs/PENGGABUNGAN.md). The pencairan part is gone with the
 * Pencairan menu; Laporan Pendapatan carries the invoice status.
 *
 * Laravel's dashboard took transaksi.pendapatan as revenue and showed
 * "Laba Bersih = pendapatan − biaya". That column is the payment to truck
 * owners, so the figure was a cost minus costs (10-integrasi-
 * operasional.md). Here revenue is what is invoiced (Laporan Pendapatan),
 * the truck payment is listed among the costs as Beban Rekanan, and the
 * bottom line is laba bersih as defined in $lib/server/ringkasan-operasional
 * — the same figure the Ringkasan Eksekutif shows.
 */
export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  if (!opEntity) return { periode, dasbor: null };

  const db = locals.supabase;
  const entityId = opEntity.id;

  const [bulan, partner, masterResults] = await Promise.all([
    hitungBulan(db, entityId, periode),
    muatPartner(db, entityId, periode),
    Promise.all(
      (['pemilik', 'kendaraan', 'kapal', 'karyawan'] as const).map((t) =>
        db.from(t).select('id', { count: 'exact', head: true }).eq('entity_id', entityId)
      )
    )
  ]);
  const { kegiatan, gaji, pendapatan } = bulan;
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
      ringkas: bulan.volume,
      pendapatan: { semua: pendapatan.semua, belum: pendapatan.belum, sudah: pendapatan.sudah },
      pengeluaran: bulan.pengeluaran,
      totalPengeluaran: bulan.totalPengeluaran,
      labaBersih: bulan.labaBersih,
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
