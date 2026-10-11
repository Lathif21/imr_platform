import type { PageServerLoad } from './$types';
import { periodeDari, rentangBulan } from '$lib/operasional/kegiatan';
import { failLoad } from '$lib/server/operasional';

/**
 * Laporan Paguyuban — LaporanController::paguyuban. Iuran per truck
 * (paguyuban.total_bayar = tonase × tarif), grouped by the ship's
 * nama_paguyuban.
 *
 * Laravel listed only ships that have a nama_paguyuban, but no screen saves
 * that column (KapalController ignores it), so every ship added since sits
 * outside every group and its fees vanished from this report while still
 * being charged. Here they appear as "(Tanpa nama paguyuban)", so the total
 * matches what was actually charged.
 */
const TANPA = '__tanpa__';

export interface BarisIuran {
  tanggal: string;
  kapal: string;
  nopol: string;
  tonase: number;
  tarif: number;
  total: number;
}

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  const dipilih = url.searchParams.get('paguyuban');
  const kosong = {
    periode,
    dipilih,
    grup: [] as { kunci: string; nama: string; kapal: number; transaksi: number; tonase: number; total: number }[],
    rincian: [] as BarisIuran[],
    kapalGrup: [] as { nama_kapal: string; kapasitas_ton: number | null; total: number }[]
  };
  if (!opEntity) return kosong;

  const db = locals.supabase;
  const { dari, sampai } = rentangBulan(periode);
  const [trxResult, kapalResult, kendaraanResult] = await Promise.all([
    db
      .from('transaksi_operasional')
      .select('id, kapal_id, kendaraan_id, tanggal, tonase')
      .eq('entity_id', opEntity.id)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .order('tanggal')
      .returns<{ id: number; kapal_id: number; kendaraan_id: number | null; tanggal: string; tonase: string }[]>(),
    db
      .from('kapal')
      .select('id, nama_kapal, nama_paguyuban, kapasitas_ton')
      .eq('entity_id', opEntity.id)
      .order('nama_kapal')
      .returns<{ id: number; nama_kapal: string; nama_paguyuban: string | null; kapasitas_ton: string | null }[]>(),
    db.from('kendaraan').select('id, nopol').eq('entity_id', opEntity.id).returns<{ id: number; nopol: string }[]>()
  ]);
  if (trxResult.error) failLoad('paguyuban transaksi', trxResult.error);
  if (kapalResult.error) failLoad('paguyuban kapal', kapalResult.error);
  if (kendaraanResult.error) failLoad('paguyuban kendaraan', kendaraanResult.error);

  const trx = trxResult.data ?? [];
  const { data: iuran, error } = await db
    .from('paguyuban')
    .select('transaksi_id, tarif, total_bayar')
    .in('transaksi_id', trx.map((t) => t.id))
    .returns<{ transaksi_id: number; tarif: string; total_bayar: string }[]>();
  if (error) failLoad('paguyuban', error);

  const kapal = new Map((kapalResult.data ?? []).map((k) => [k.id, k]));
  const nopol = new Map((kendaraanResult.data ?? []).map((k) => [k.id, k.nopol]));
  const perTrx = new Map((iuran ?? []).map((p) => [p.transaksi_id, p]));
  const kunciKapal = (id: number) => {
    const nama = kapal.get(id)?.nama_paguyuban?.trim();
    return nama ? nama : TANPA;
  };

  const baris = trx
    .filter((t) => perTrx.has(t.id))
    .map((t) => {
      const p = perTrx.get(t.id)!;
      return {
        kunci: kunciKapal(t.kapal_id),
        kapal_id: t.kapal_id,
        tanggal: t.tanggal,
        kapal: kapal.get(t.kapal_id)?.nama_kapal ?? '—',
        nopol: t.kendaraan_id === null ? '—' : (nopol.get(t.kendaraan_id) ?? '—'),
        tonase: Number(t.tonase),
        tarif: Number(p.tarif),
        total: Number(p.total_bayar)
      };
    });

  const kunciSemua = new Set([...(kapalResult.data ?? []).map((k) => kunciKapal(k.id)), ...baris.map((b) => b.kunci)]);
  const grup = [...kunciSemua]
    .map((kunci) => {
      const rows = baris.filter((b) => b.kunci === kunci);
      return {
        kunci,
        nama: kunci === TANPA ? '(Tanpa nama paguyuban)' : kunci,
        kapal: (kapalResult.data ?? []).filter((k) => kunciKapal(k.id) === kunci).length,
        transaksi: rows.length,
        tonase: rows.reduce((s, r) => s + r.tonase, 0),
        total: rows.reduce((s, r) => s + r.total, 0)
      };
    })
    .filter((g) => g.kunci !== TANPA || g.transaksi > 0)
    .sort((a, b) => (a.kunci === TANPA ? 1 : b.kunci === TANPA ? -1 : a.nama.localeCompare(b.nama, 'id')));

  const rincian = dipilih ? baris.filter((b) => b.kunci === dipilih) : [];
  return {
    ...kosong,
    grup,
    rincian: rincian.map(({ kunci: _k, kapal_id: _i, ...r }) => r),
    kapalGrup: dipilih
      ? (kapalResult.data ?? [])
          .filter((k) => kunciKapal(k.id) === dipilih)
          .map((k) => ({
            nama_kapal: k.nama_kapal,
            kapasitas_ton: k.kapasitas_ton === null ? null : Number(k.kapasitas_ton),
            total: rincian.filter((r) => r.kapal_id === k.id).reduce((s, r) => s + r.total, 0)
          }))
      : []
  };
};
