/**
 * One period's P&L as a finished statement, for the download formats: the
 * printable page (→ PDF) and the Excel file. Offered only once the period is
 * approved or locked — before that the figures can still change.
 *
 * Rows are assembled in the same order as the statement on screen
 * (entities/[id]/periods/[period]/+page.svelte). Section totals and the three
 * subtotals come from `v_period_pnl` and are never recomputed (invariant 2).
 */
import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  LINE_SECTION_LABEL,
  PERIOD_STATUS_LABEL,
  REPORTING_BASIS_LABEL,
  type LineSection,
  type Numeric,
  type PeriodPnl,
  type PeriodStatus,
  type ReportingBasis
} from '$lib/domain';
import { MONTH_PATTERN, formatPeriod, monthToPeriod } from '$lib/format';

export type BarisPnl =
  | { jenis: 'bagian'; label: string; jumlah: number }
  | { jenis: 'pos'; kode: string; label: string; jumlah: number; catatan: string | null }
  | { jenis: 'subtotal'; label: string; jumlah: number };

export interface LaporanPnl {
  entitas: { id: string; code: string; legal_name: string; reporting_basis: ReportingBasis };
  bulan: string;
  judulPeriode: string;
  status: PeriodStatus;
  statusLabel: string;
  basisLabel: string;
  baris: BarisPnl[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BOLEH_UNDUH: PeriodStatus[] = ['approved', 'locked'];

const n = (v: Numeric | null | undefined) => Number(v ?? 0) || 0;

/** Reads as the caller — an entity or period RLS hides is a 404. */
export async function muatLaporanPnl(db: SupabaseClient, entityId: string, month: string): Promise<LaporanPnl> {
  if (!UUID.test(entityId) || !MONTH_PATTERN.test(month)) error(404, 'Laporan tidak ditemukan.');

  const [{ data: entitas }, { data: periode }] = await Promise.all([
    db
      .from('entities')
      .select('id, code, legal_name, reporting_basis')
      .eq('id', entityId)
      .maybeSingle<LaporanPnl['entitas']>(),
    db
      .from('periods')
      .select('id, status, template_id')
      .eq('entity_id', entityId)
      .eq('period', monthToPeriod(month))
      .maybeSingle<{ id: string; status: PeriodStatus; template_id: string }>()
  ]);
  if (!entitas || !periode) error(404, 'Laporan tidak ditemukan.');
  if (!BOLEH_UNDUH.includes(periode.status)) {
    error(409, 'Laporan baru bisa diunduh setelah disetujui.');
  }

  const [pnlResult, templateResult, linesResult] = await Promise.all([
    db.from('v_period_pnl').select('*').eq('period_id', periode.id).maybeSingle<PeriodPnl>(),
    db
      .from('report_template_lines')
      .select('line_code, line_label, section, sort_order')
      .eq('template_id', periode.template_id)
      .order('sort_order')
      .returns<{ line_code: string; line_label: string; section: LineSection; sort_order: number }[]>(),
    db
      .from('report_lines')
      .select('line_code, amount, note')
      .eq('period_id', periode.id)
      .returns<{ line_code: string; amount: Numeric; note: string | null }[]>()
  ]);
  const err = pnlResult.error ?? templateResult.error ?? linesResult.error;
  if (err) {
    console.error('[pnl-laporan]', err.code, err.message);
    error(500, 'Gagal memuat laporan.');
  }
  const pnl = pnlResult.data;
  if (!pnl) error(404, 'Laporan tidak ditemukan.');

  const template = new Map((templateResult.data ?? []).map((t) => [t.line_code, t]));
  const baris: BarisPnl[] = [];

  const bagian = (section: LineSection) => {
    const lines = (linesResult.data ?? [])
      .filter((l) => template.get(l.line_code)?.section === section)
      .sort((a, b) => (template.get(a.line_code)?.sort_order ?? 0) - (template.get(b.line_code)?.sort_order ?? 0));
    // As on screen: a section nobody reported is left out, not shown as zeros.
    if (lines.length === 0) return;
    baris.push({ jenis: 'bagian', label: LINE_SECTION_LABEL[section], jumlah: n(pnl[section]) });
    for (const l of lines) {
      baris.push({
        jenis: 'pos',
        kode: l.line_code,
        label: template.get(l.line_code)?.line_label ?? l.line_code,
        jumlah: n(l.amount),
        catatan: l.note
      });
    }
  };

  bagian('revenue');
  bagian('cogs');
  baris.push({ jenis: 'subtotal', label: 'Laba Kotor', jumlah: n(pnl.gross_profit) });
  bagian('opex');
  baris.push({ jenis: 'subtotal', label: 'Laba Operasi', jumlah: n(pnl.operating_profit) });
  bagian('other_income');
  bagian('other_expense');
  bagian('tax');
  baris.push({ jenis: 'subtotal', label: 'Laba Bersih', jumlah: n(pnl.net_profit) });

  return {
    entitas,
    bulan: month,
    judulPeriode: formatPeriod(monthToPeriod(month)),
    status: periode.status,
    statusLabel: PERIOD_STATUS_LABEL[periode.status],
    basisLabel: REPORTING_BASIS_LABEL[entitas.reporting_basis],
    baris
  };
}
