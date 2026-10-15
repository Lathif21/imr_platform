import { error, redirect } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bulanIni, periodeDari, type Periode } from '$lib/operasional/kegiatan';
import { sudahDibayar } from '$lib/operasional/pendapatan';
import {
  PIUTANG_LAMA_HARI,
  geserBulan,
  peringatan,
  umurHari,
  type AngkaBulan,
  type BarisRingkasan,
  type Piutang
} from '$lib/operasional/ringkasan';
import { canReadOperational, canWriteOperational } from '$lib/roles';
import { failLoad, loadOperationalEntities } from '$lib/server/operasional';
import { hitungBanyak, kunciHasil, type HasilBulan } from '$lib/server/ringkasan-operasional';
import type { PageServerLoad } from './$types';

/**
 * Ringkasan Eksekutif — what direksi and manajer open first (decided 16
 * Oktober 2026). One row per entity, straight from the operational input:
 * there is no approval step in practice, so nothing here waits for one.
 *
 * Entities come from the caller's RLS: direksi all of them, manajer the ones
 * assigned in Admin → Pengguna. Admin operasional works in its own module and
 * is sent there.
 *
 * All entities × six months come from one batch (hitungBanyak, about ten
 * queries), so the trend costs no more than the month itself.
 */

const TREN_BULAN = 6;

function angka(b: HasilBulan): AngkaBulan {
  return {
    pendapatan: b.pendapatan.semua.total,
    pajak: b.pendapatan.semua.pajak,
    pengeluaran: b.totalPengeluaran,
    bebanRekanan: b.bebanRekanan,
    laba: b.labaBersih,
    kegiatan: b.volume.kegiatan,
    tonase: b.volume.tonase
  };
}

/** Unpaid invoices of every month, as of today — a position, not a flow. */
async function muatPiutang(db: SupabaseClient, entityIds: string[], now: Date): Promise<Map<string, Piutang>> {
  const { data, error: err } = await db
    .from('laporan_pendapatan')
    .select('entity_id, net_tagihan, status_entry, payment_date, tanggal_entry, bulan, tahun')
    .in('entity_id', entityIds)
    .is('payment_date', null)
    .returns<
      {
        entity_id: string;
        net_tagihan: string | null;
        status_entry: string | null;
        payment_date: string | null;
        tanggal_entry: string | null;
        bulan: number;
        tahun: number;
      }[]
    >();
  if (err) failLoad('ringkasan piutang', err);

  const semua = new Map<string, Piutang>(
    entityIds.map((id) => [id, { nilai: 0, jumlah: 0, tertuaHari: null, lama: { nilai: 0, jumlah: 0 } }])
  );
  for (const r of data ?? []) {
    if (sudahDibayar(r)) continue;
    const piutang = semua.get(r.entity_id);
    if (!piutang) continue;
    const nilai = Number(r.net_tagihan ?? 0) || 0;
    // Without an entry date, the first of the invoice's month: the most it
    // can be, so a missing date never hides an old invoice.
    const tanggal = r.tanggal_entry ?? `${r.tahun}-${String(r.bulan).padStart(2, '0')}-01`;
    const umur = umurHari(tanggal, now);
    piutang.nilai += nilai;
    piutang.jumlah += 1;
    piutang.tertuaHari = Math.max(piutang.tertuaHari ?? 0, umur);
    if (umur > PIUTANG_LAMA_HARI) {
      piutang.lama.nilai += nilai;
      piutang.lama.jumlah += 1;
    }
  }
  return semua;
}

/** The latest operational write for an entity, across the tables admins fill. */
async function muatTerakhirInput(db: SupabaseClient, entityId: string): Promise<string | null> {
  const tables = ['operasional_rekap', 'transaksi_operasional', 'laporan_pendapatan', 'pengeluaran'] as const;
  const results = await Promise.all(
    tables.map((t) =>
      db
        .from(t)
        .select('updated_at')
        .eq('entity_id', entityId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .returns<{ updated_at: string }[]>()
    )
  );
  let latest: string | null = null;
  for (const r of results) {
    if (r.error) failLoad('ringkasan input terakhir', r.error);
    const t = r.data?.[0]?.updated_at;
    if (t && (!latest || Date.parse(t) > Date.parse(latest))) latest = t;
  }
  return latest;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (canWriteOperational(locals.role)) redirect(303, '/operasional');
  if (!canReadOperational(locals.role)) error(403, 'Peran Anda tidak membaca laporan entitas.');

  const db = locals.supabase;
  const periode = periodeDari(url);
  const lalu = geserBulan(periode, -1);
  const now = new Date();
  const sekarang = bulanIni(now);
  const bulanBerjalan = periode.bulan === sekarang.bulan && periode.tahun === sekarang.tahun;

  const { entities } = await loadOperationalEntities(db, null);
  const ids = entities.map((e) => e.id);
  const bulanTren: Periode[] = Array.from({ length: TREN_BULAN }, (_, k) => geserBulan(periode, k - (TREN_BULAN - 1)));

  const [hasil, piutang, terakhir] = await Promise.all([
    hitungBanyak(db, ids, bulanTren),
    muatPiutang(db, ids, now),
    Promise.all(entities.map((e) => muatTerakhirInput(db, e.id)))
  ]);

  const rows: BarisRingkasan[] = entities.map((e, i) => ({
    code: e.code,
    nama: e.legal_name,
    ini: angka(hasil.get(kunciHasil(e.id, periode))!),
    lalu: angka(hasil.get(kunciHasil(e.id, lalu))!),
    piutang: piutang.get(e.id)!,
    terakhirInput: terakhir[i]
  }));

  const tren: Record<string, { periode: Periode; laba: number; pendapatan: number }[]> = Object.fromEntries(
    entities.map((e) => [
      e.code,
      bulanTren.map((p) => {
        const h = hasil.get(kunciHasil(e.id, p))!;
        return { periode: p, laba: h.labaBersih, pendapatan: h.pendapatan.semua.total };
      })
    ])
  );

  return {
    periode,
    bulanBerjalan,
    rows,
    peringatan: peringatan(rows, { bulanBerjalan, now }),
    tren
  };
};
