import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { bacaAngka, bacaRupiah } from '$lib/operasional/kegiatan';
import { muatKegiatan } from '$lib/server/kegiatan';
import { explainDbError, failLoad, invalid, refuse } from '$lib/server/operasional';

/**
 * Rincian Pembayaran Truk — LaporanController::editKegiatanPartner and
 * ::updatePembayaranBulk. Per truck: ritase, tonase, ongkos angkut per ton,
 * saku supir, terpal. Beban rekanan (column `pendapatan`) and the paguyuban
 * fee are derived from them by simpan_pembayaran_truk(), never typed.
 */

export interface PembayaranRow {
  id: number;
  nopol: string;
  pemilik: string;
  ritase: number;
  tonase: number;
  ongkos_angkut: number;
  sangu_supir: number;
  terpal: number;
  /** Tarif tersimpan; 500 untuk truk yang belum punya iuran. */
  tarif_paguyuban: number;
}

export const load: PageServerLoad = async ({ locals, parent, params }) => {
  const { opEntity } = await parent();
  if (!opEntity) error(404, 'Kegiatan tidak ditemukan.');
  const db = locals.supabase;

  const kegiatan = await muatKegiatan(db, params.id, opEntity.id);

  const [transaksiResult, kendaraanResult, pemilikResult] = await Promise.all([
    db
      .from('transaksi_operasional')
      .select('id, kendaraan_id, ritase, tonase, ongkos_angkut, sangu_supir, terpal')
      .eq('operasional_rekap_id', kegiatan.id)
      .order('id')
      .returns<
        {
          id: number;
          kendaraan_id: number | null;
          ritase: number;
          tonase: string;
          ongkos_angkut: string;
          sangu_supir: string;
          terpal: string;
        }[]
      >(),
    db.from('kendaraan').select('id, nopol, pemilik_id').eq('entity_id', opEntity.id).returns<{ id: number; nopol: string; pemilik_id: number }[]>(),
    db.from('pemilik').select('id, nama_pemilik').eq('entity_id', opEntity.id).returns<{ id: number; nama_pemilik: string }[]>()
  ]);

  if (transaksiResult.error) failLoad('transaksi_operasional', transaksiResult.error);
  if (kendaraanResult.error) failLoad('kendaraan', kendaraanResult.error);
  if (pemilikResult.error) failLoad('pemilik', pemilikResult.error);

  const transaksi = transaksiResult.data ?? [];
  const { data: paguyuban, error: pagError } = await db
    .from('paguyuban')
    .select('transaksi_id, tarif')
    .in('transaksi_id', transaksi.map((t) => t.id))
    .returns<{ transaksi_id: number; tarif: string }[]>();
  if (pagError) failLoad('paguyuban', pagError);

  const tarif = new Map((paguyuban ?? []).map((p) => [p.transaksi_id, Number(p.tarif)]));
  const pemilik = new Map((pemilikResult.data ?? []).map((p) => [p.id, p.nama_pemilik]));
  const kendaraan = new Map((kendaraanResult.data ?? []).map((k) => [k.id, k]));

  const truk: PembayaranRow[] = transaksi.map((t) => {
    const k = t.kendaraan_id === null ? undefined : kendaraan.get(t.kendaraan_id);
    return {
      id: t.id,
      nopol: k?.nopol ?? '—',
      pemilik: (k && pemilik.get(k.pemilik_id)) ?? '—',
      ritase: t.ritase,
      tonase: Number(t.tonase),
      ongkos_angkut: Number(t.ongkos_angkut),
      sangu_supir: Number(t.sangu_supir),
      terpal: Number(t.terpal),
      tarif_paguyuban: tarif.get(t.id) ?? 500
    };
  });
  truk.sort((a, b) => a.pemilik.localeCompare(b.pemilik, 'id') || a.nopol.localeCompare(b.nopol));

  return { kegiatan, truk };
};

export const actions: Actions = {
  simpan: async ({ locals, request, params }) => {
    const form = await request.formData();
    let raw: Record<string, unknown>[] = [];
    try {
      const parsed = JSON.parse(String(form.get('truk') ?? '[]'));
      if (Array.isArray(parsed)) raw = parsed;
    } catch {
      return refuse('Rincian pembayaran tidak terbaca. Muat ulang halaman lalu coba lagi.');
    }
    if (raw.length === 0) return refuse('Tidak ada rincian pembayaran yang diperbarui.');

    const details: string[] = [];
    const truk = raw.map((item) => {
      const nopol = String(item.nopol ?? '');
      const ritaseText = String(item.ritase ?? '').trim();
      const ritase = ritaseText === '' ? 0 : Number(ritaseText);
      const tonase = bacaAngka(String(item.tonase ?? ''));
      const ongkos = bacaRupiah(String(item.ongkos_angkut ?? ''));
      const sangu = bacaRupiah(String(item.sangu_supir ?? ''));
      const terpal = bacaRupiah(String(item.terpal ?? ''));

      if (!Number.isInteger(ritase) || ritase < 0) details.push(`Truk ${nopol}: ritase harus bilangan bulat 0 atau lebih.`);
      if (tonase === null) details.push(`Truk ${nopol}: tonase harus angka 0 atau lebih, mis. 12,5.`);
      if (ongkos === null) details.push(`Truk ${nopol}: ongkos angkut harus angka rupiah.`);
      if (sangu === null) details.push(`Truk ${nopol}: saku supir harus angka rupiah.`);
      if (terpal === null) details.push(`Truk ${nopol}: terpal harus angka rupiah.`);

      return {
        id: Number(item.id),
        ritase,
        tonase: tonase ?? 0,
        ongkos_angkut: ongkos ?? 0,
        sangu_supir: sangu ?? 0,
        terpal: terpal ?? 0
      };
    });
    if (details.length) return invalid(details);

    const { error: err } = await locals.supabase.rpc('simpan_pembayaran_truk', {
      p_rekap_id: Number(params.id),
      p_truk: truk
    });
    if (err) return refuse(explainDbError('simpan_pembayaran_truk', err, { fallback: 'Rincian pembayaran truk gagal disimpan.' }));

    return {
      title: 'Berhasil disimpan',
      message: `${truk.length} rincian pembayaran truk berhasil diperbarui sekaligus.`
    };
  }
};
