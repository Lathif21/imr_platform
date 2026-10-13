/**
 * Pos laporan dari modul Operasional platform ini.
 *
 * Sejak 13 Oktober 2026 angka P&L ILJ dan ILA dihitung dan ditulis di
 * database (`pnl_operasional_terpetakan`, `segarkan_pnl_operasional`,
 * migrasi 20250121) — tidak lagi ditarik lewat HTTP dari sistem Laravel.
 * Draft diperbarui otomatis setiap kali data operasional bulannya berubah.
 *
 * Berkas ini hanya menyiapkan yang perlu dibaca orang di layar Input Laporan:
 * jenis biaya yang belum dipetakan atau sengaja tidak ditarik, dan — untuk
 * periode yang sudah diajukan — pos yang angkanya berubah sesudahnya.
 * Nominal tetap string; tidak ada penjumlahan di sini.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Numeric, PeriodStatus } from '$lib/domain';

/**
 * Asal biaya. `pengeluaran` dikelompokkan per kolom `jenis`; `honor_telly`
 * adalah gaji admin bulanan yang dicatat di Honor Telly.
 */
export type SumberBiaya = 'pengeluaran' | 'honor_telly';

/** Pos penampung biaya yang belum dipetakan. */
export const POS_BELUM_DIPETAKAN = 'OPEX_LAIN';

/** Satu baris `operational_expense_mapping`. `line_code` null = tidak ditarik. */
export interface PemetaanBiaya {
  source: SumberBiaya;
  jenis: string;
  line_code: string | null;
}

/** Satu jenis biaya satu bulan. */
export interface BiayaJenis {
  sumber: SumberBiaya;
  jenis: string;
  jumlah: string;
  baris: number;
}

/** Satu jenis biaya yang pernah dicatat, untuk layar Pemetaan Biaya. */
export interface JenisTercatat {
  sumber: SumberBiaya;
  jenis: string;
  baris: number;
  /** Tanggal terakhir dipakai, YYYY-MM-DD. */
  terakhir: string | null;
}

export interface SelisihPos {
  line_code: string;
  line_label: string;
  tercatat: string;
  sekarang: string;
}

export interface InfoOperasional {
  belumDipetakan: BiayaJenis[];
  tidakDitarik: BiayaJenis[];
  /** Hanya untuk periode yang bukan draft: pos yang berubah sejak diajukan. */
  selisih: SelisihPos[];
}

interface InfoMentah {
  terhitung: Record<string, string>;
  biaya: (BiayaJenis & { dipetakan: boolean; line_code: string | null })[];
}

/** Two amounts as cents, so "345000" and "345000.00" compare equal without floats. */
const sen = (v: Numeric | null | undefined) => {
  const [utuh, pecahan = ''] = String(v ?? '0').split('.');
  return `${utuh}.${pecahan.padEnd(2, '0').slice(0, 2)}`;
};

/**
 * Null when the entity's report is not filled from the Operasional module
 * (no operational template), so the screen shows no button and no notice.
 * A failure to read is logged and treated the same way: entering the report
 * by hand is the main path, and this is help on top of it.
 */
export async function muatInfoOperasional(
  db: SupabaseClient,
  entityId: string,
  period: { period: string; status: PeriodStatus },
  reportLines: { line_code: string; amount: Numeric }[],
  templateLines: { line_code: string; line_label: string }[]
): Promise<InfoOperasional | null> {
  const { data: entitas, error: entitasError } = await db.rpc('entitas_operasional');
  if (entitasError) {
    console.error('[entry form] entitas_operasional:', entitasError.code, entitasError.message);
    return null;
  }
  if (!((entitas ?? []) as { id: string }[]).some((e) => e.id === entityId)) return null;

  const { data, error } = await db.rpc('info_pnl_operasional', { p_entity_id: entityId, p_periode: period.period });
  if (error || !data) {
    console.error('[entry form] info_pnl_operasional:', error?.code, error?.message);
    return null;
  }
  const info = data as InfoMentah;

  const selisih: SelisihPos[] = [];
  if (period.status !== 'draft') {
    const tercatat = new Map(reportLines.map((l) => [l.line_code, l.amount]));
    for (const t of templateLines) {
      const sekarang = info.terhitung[t.line_code];
      if (sekarang === undefined) continue;
      const lama = tercatat.get(t.line_code) ?? '0';
      if (sen(lama) !== sen(sekarang)) {
        selisih.push({ line_code: t.line_code, line_label: t.line_label, tercatat: String(lama), sekarang });
      }
    }
  }

  return {
    belumDipetakan: info.biaya.filter((b) => !b.dipetakan),
    tidakDitarik: info.biaya.filter((b) => b.dipetakan && b.line_code === null),
    selisih
  };
}
