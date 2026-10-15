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
import { hitungBulan } from '$lib/server/ringkasan-operasional';
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
 * The month and the one before are awaited; the six-month trend is streamed,
 * so the table is on screen while the trend is still being added up.
 */

const TREN_BULAN = 6;

function angka(b: Awaited<ReturnType<typeof hitungBulan>>): AngkaBulan {
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
async function muatPiutang(db: SupabaseClient, entityId: string, now: Date): Promise<Piutang> {
  const { data, error: err } = await db
    .from('laporan_pendapatan')
    .select('net_tagihan, status_entry, payment_date, tanggal_entry, bulan, tahun')
    .eq('entity_id', entityId)
    .is('payment_date', null)
    .returns<
      {
        net_tagihan: string | null;
        status_entry: string | null;
        payment_date: string | null;
        tanggal_entry: string | null;
        bulan: number;
        tahun: number;
      }[]
    >();
  if (err) failLoad('ringkasan piutang', err);

  const piutang: Piutang = { nilai: 0, jumlah: 0, tertuaHari: null, lama: { nilai: 0, jumlah: 0 } };
  for (const r of data ?? []) {
    if (sudahDibayar(r)) continue;
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
  return piutang;
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

  const rows: BarisRingkasan[] = await Promise.all(
    entities.map(async (e) => {
      const [ini, sebelum, piutang, terakhirInput] = await Promise.all([
        hitungBulan(db, e.id, periode),
        hitungBulan(db, e.id, lalu),
        muatPiutang(db, e.id, now),
        muatTerakhirInput(db, e.id)
      ]);
      return { code: e.code, nama: e.legal_name, ini: angka(ini), lalu: angka(sebelum), piutang, terakhirInput };
    })
  );

  // The four months before those two, per entity — streamed.
  const lebihAwal: Periode[] = Array.from({ length: TREN_BULAN - 2 }, (_, i) =>
    geserBulan(periode, -(TREN_BULAN - 1) + i)
  );
  const tren: Promise<Record<string, { periode: Periode; laba: number; pendapatan: number }[]>> = Promise.all(
    entities.map(async (e, i) => {
      const awal = await Promise.all(lebihAwal.map((p) => hitungBulan(db, e.id, p)));
      const titik = [
        ...awal.map((b, j) => ({ periode: lebihAwal[j], laba: b.labaBersih, pendapatan: b.pendapatan.semua.total })),
        { periode: lalu, laba: rows[i].lalu.laba, pendapatan: rows[i].lalu.pendapatan },
        { periode, laba: rows[i].ini.laba, pendapatan: rows[i].ini.pendapatan }
      ];
      return [e.code, titik] as const;
    })
  ).then(Object.fromEntries);

  return {
    periode,
    bulanBerjalan,
    rows,
    peringatan: peringatan(rows, { bulanBerjalan, now }),
    tren
  };
};
