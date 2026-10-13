import { error, fail, redirect } from '@sveltejs/kit';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { LineSection, Numeric, PeriodStatus } from '$lib/domain';
import {
  AMOUNT_LIMIT,
  MONTH_PATTERN,
  formatAmount,
  isDisplayRounding,
  parseAmountInput
} from '$lib/format';
import { canEnterReports } from '$lib/roles';
import { MAX_UPLOAD_BYTES, parseWorkbook } from '$lib/server/report-excel';
import { loadEntryAccess } from '../access';
import { muatInfoOperasional } from './operational';
import type { Actions, PageServerLoad } from './$types';

interface PeriodRow {
  id: string;
  period: string;
  status: PeriodStatus;
  template_id: string;
  rejection_note: string | null;
}

interface TemplateLine {
  line_code: string;
  line_label: string;
  section: LineSection;
  sort_order: number;
  help_text: string | null;
}

interface ReportLine {
  line_code: string;
  amount: Numeric;
  note: string | null;
}

/**
 * Postgres messages name tables, columns and policies. Everything goes to the
 * server log; the browser gets a fixed sentence.
 *
 * The exception is our own triggers. `guard_period_editable`,
 * `guard_line_code_in_template` and `guard_period_transition` raise messages
 * that were written for the person reading the screen, already in Indonesian.
 * Those pass through verbatim — `P0001` is how they are recognised.
 */
function explain(context: string, cause: PostgrestError, fallback: string): string {
  console.error(`[entry form] ${context}:`, cause.code, cause.message, cause.details);
  return cause.code === 'P0001' ? cause.message : fallback;
}

function failLoad(context: string, cause: PostgrestError): never {
  console.error(`[entry form] ${context}:`, cause.code, cause.message, cause.details);
  error(500, 'Gagal memuat formulir laporan.');
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
  if (!canEnterReports(locals.role)) {
    error(403, 'Laporan diisi oleh staf entitas.');
  }

  // The URL carries YYYY-MM; the column stores the first of the month.
  if (!MONTH_PATTERN.test(params.period)) error(404, 'Periode tidak ditemukan.');

  const { entities, selected, error: accessError } = await loadEntryAccess(
    locals.supabase,
    url.searchParams.get('entitas')
  );
  if (accessError) failLoad('user_entity_access', accessError);
  if (!selected) error(403, 'Akun Anda belum ditautkan ke entitas mana pun. Hubungi direksi.');

  const { data: period, error: periodError } = await locals.supabase
    .from('periods')
    .select('id, period, status, template_id, rejection_note')
    .eq('entity_id', selected.id)
    .eq('period', `${params.period}-01`)
    .maybeSingle<PeriodRow>();

  if (periodError) failLoad('periods', periodError);
  if (!period) error(404, 'Periode ini belum dibuat untuk entitas Anda.');

  const [templateResult, linesResult] = await Promise.all([
    /**
     * The template of the period, not the newest one. A period keeps the
     * template it was created with so a historical statement still reads with
     * the labels that were in force when it was filled in.
     */
    locals.supabase
      .from('report_template_lines')
      .select('line_code, line_label, section, sort_order, help_text')
      .eq('template_id', period.template_id)
      .eq('is_active', true)
      .order('sort_order')
      .returns<TemplateLine[]>(),
    locals.supabase
      .from('report_lines')
      .select('line_code, amount, note')
      .eq('period_id', period.id)
      .returns<ReportLine[]>()
  ]);

  const firstError = templateResult.error ?? linesResult.error;
  if (firstError) failLoad('template or report lines', firstError);

  const reportLines = linesResult.data ?? [];
  const operasional = await muatInfoOperasional(locals.supabase, selected.id, period, reportLines, templateResult.data ?? []);

  return {
    entities,
    selected,
    period,
    month: params.period,
    templateLines: templateResult.data ?? [],
    /**
     * Only the lines that exist. A template line with no row shows 0 — nothing
     * is inserted on load, so opening a period never creates rows and never
     * touches `updated_at` or the audit log.
     */
    reportLines,
    /** Null for an entity whose report is not filled from the Operasional module. */
    operasional
  };
};

interface LineInput {
  line_code: string;
  amount: number;
  note: string | null;
}

/**
 * Read the posted rows.
 *
 * The line codes come from the form, not from the template, and they are sent
 * to the database as they arrive. That is deliberate:
 * `guard_line_code_in_template` is the authority on which codes exist, and its
 * refusal is a readable Indonesian sentence naming the offending code.
 * Filtering here would instead drop a bad code silently — the exact failure
 * the trigger exists to prevent, moved up a layer.
 */
function collectLines(form: FormData): LineInput[] {
  const prefix = 'amount__';
  const lines: LineInput[] = [];

  for (const [key, value] of form.entries()) {
    if (!key.startsWith(prefix)) continue;
    const code = key.slice(prefix.length);
    if (code === '') continue;

    const note = String(form.get(`note__${code}`) ?? '').trim();
    lines.push({
      line_code: code,
      amount: parseAmountInput(String(value)),
      note: note === '' ? null : note
    });
  }

  return lines;
}

/**
 * Persist the posted rows.
 *
 * A row that is 0 with no note is deleted rather than stored. A statement has
 * far more lines than any one month uses, and keeping zeros would fill
 * `report_lines` with rows that say nothing — and put a row in `audit_log` for
 * each of them.
 *
 * The status is never checked before writing. `guard_period_editable` and the
 * `lines_write` policy decide whether the period is still editable, and their
 * refusal is what the user sees (roles.ts states this explicitly).
 */
async function writeLines(
  supabase: SupabaseClient,
  periodId: string,
  posted: LineInput[]
): Promise<PostgrestError | null> {
  /**
   * Lines the person did not change are left alone. The form only knows whole
   * Rupiah, so a pulled 1.897,50 comes back as 1.898; writing that would
   * change the figure and flip it to 'manual' without anyone deciding to.
   */
  const { data: stored, error: readError } = await supabase
    .from('report_lines')
    .select('line_code, amount, note')
    .eq('period_id', periodId)
    .returns<{ line_code: string; amount: Numeric; note: string | null }[]>();
  if (readError) return readError;

  const byCode = new Map((stored ?? []).map((row) => [row.line_code, row]));
  const lines = posted.filter((line) => {
    const row = byCode.get(line.line_code);
    return !(row && (row.note ?? null) === line.note && isDisplayRounding(row.amount, line.amount));
  });

  const keep = lines.filter((line) => line.amount !== 0 || line.note !== null);
  const drop = lines
    .filter((line) => line.amount === 0 && line.note === null)
    .map((line) => line.line_code);

  if (keep.length > 0) {
    const { error: upsertError } = await supabase.from('report_lines').upsert(
      keep.map((line) => ({
        period_id: periodId,
        line_code: line.line_code,
        amount: line.amount,
        note: line.note,
        /**
         * Dikirim eksplisit, bukan dibiarkan memakai default kolom.
         *
         * Upsert hanya memperbarui kolom yang ada di payload, jadi tanpa baris
         * ini sebuah baris hasil tarik data yang kemudian dikoreksi orang akan
         * tetap tertandai 'operasional'. Yang ditandai kolom ini adalah siapa
         * yang menulis nilai terakhir, dan di sini yang menulis adalah orang.
         */
        source: 'manual'
      })),
      { onConflict: 'period_id,line_code' }
    );
    if (upsertError) return upsertError;
  }

  if (drop.length > 0) {
    const { error: deleteError } = await supabase
      .from('report_lines')
      .delete()
      .eq('period_id', periodId)
      .in('line_code', drop);
    if (deleteError) return deleteError;
  }

  return null;
}

/** Rejects a value `numeric(18,2)` cannot hold, before Postgres answers 22003
    with a message that names the column instead of the field. */
function tooLarge(lines: LineInput[]): LineInput | undefined {
  return lines.find((line) => Math.abs(line.amount) >= AMOUNT_LIMIT);
}

/**
 * Load the period by (entity, month) the same way `load` does, so an action
 * never takes a period id from the form. The month comes from the route and
 * the entity from the access list; neither is client-chosen.
 */
async function resolvePeriod(
  locals: App.Locals,
  month: string,
  requestedEntity: string
): Promise<
  | { ok: true; periodId: string; entityId: string; entityCode: string; templateId: string }
  | { ok: false; status: number; message: string }
> {
  if (!MONTH_PATTERN.test(month)) {
    return { ok: false, status: 400, message: 'Periode tidak valid.' };
  }

  const { selected, error: accessError } = await loadEntryAccess(locals.supabase, requestedEntity);
  if (accessError) {
    return {
      ok: false,
      status: 500,
      message: explain('user_entity_access', accessError, 'Gagal memeriksa akses entitas.')
    };
  }
  if (!selected) {
    return { ok: false, status: 403, message: 'Akun Anda belum ditautkan ke entitas mana pun.' };
  }

  const { data: period, error: periodError } = await locals.supabase
    .from('periods')
    .select('id, template_id')
    .eq('entity_id', selected.id)
    .eq('period', `${month}-01`)
    .maybeSingle<{ id: string; template_id: string }>();

  if (periodError) {
    return {
      ok: false,
      status: 500,
      message: explain('periods', periodError, 'Gagal memuat periode.')
    };
  }
  if (!period) {
    return { ok: false, status: 404, message: 'Periode ini tidak ada untuk entitas Anda.' };
  }

  return {
    ok: true,
    periodId: period.id,
    entityId: selected.id,
    entityCode: selected.code,
    templateId: period.template_id
  };
}

/**
 * Confirm the write actually landed.
 *
 * A DELETE the `lines_write` USING clause refuses touches zero rows and
 * reports success — see TESTING.md, "How to read a refusal". So a period that
 * left `draft` between page load and submit produces no error at all when the
 * only change was clearing a line to zero. Re-reading the status is not a
 * permission check; the database has already decided. It is the difference
 * between telling the user their edit was saved and telling them the truth.
 */
async function stillDraft(
  supabase: SupabaseClient,
  periodId: string
): Promise<{ draft: boolean; message: string }> {
  const { data } = await supabase
    .from('periods')
    .select('status')
    .eq('id', periodId)
    .maybeSingle<{ status: PeriodStatus }>();

  if (data && data.status !== 'draft') {
    return {
      draft: false,
      message: `Periode ini sudah berstatus ${data.status} dan barisnya tidak dapat diubah. Muat ulang halaman untuk melihat keadaan terkini.`
    };
  }
  return { draft: true, message: '' };
}

export const actions: Actions = {
  /**
   * Hitung ulang pos operasional periode draft ini dari modul Operasional.
   *
   * Draft sudah diperbarui otomatis setiap kali data operasional berubah
   * (segarkan_pnl_operasional, 20250121). Tombol ini untuk menimpa koreksi
   * manual pada pos operasional dan untuk draft yang dibuat sebelum ada
   * datanya. Angka dihitung dan ditulis seluruhnya di database dalam satu
   * transaksi — tidak ada nominal yang lewat JavaScript.
   */
  tarikOperasional: async ({ locals, params, request }) => {
    if (!canEnterReports(locals.role)) {
      return fail(403, { message: 'Laporan diisi oleh staf entitas.' });
    }

    const form = await request.formData();
    const target = await resolvePeriod(locals, params.period, String(form.get('entitas') ?? ''));
    if (!target.ok) return fail(target.status, { message: target.message });

    const { data: hasil, error: rpcError } = await locals.supabase.rpc('segarkan_pnl_operasional', {
      p_entity_id: target.entityId,
      p_periode: `${params.period}-01`
    });
    if (rpcError) {
      return fail(400, { message: explain('segarkan_pnl_operasional', rpcError, 'Gagal menghitung ulang dari data operasional.') });
    }
    if (hasil === 'terkunci') {
      return fail(409, { message: 'Periode ini sudah tidak berstatus draft. Kembalikan ke draft untuk memperbarui angkanya.' });
    }
    if (hasil === 'tanpa_template' || hasil === 'tanpa_data' || hasil === 'dihapus') {
      return fail(409, { message: 'Bulan ini tidak punya data operasional untuk dihitung.' });
    }
    return { pulled: true };
  },

  /**
   * Isi periode draft dari file Excel (template yang diunduh dari layar ini).
   *
   * Semua-atau-tidak-sama-sekali: kode di luar template, kode ganda, atau
   * nominal yang tak terbaca menolak seluruh file sebelum satu baris pun
   * ditulis — laporan setengah terisi terlihat lengkap.
   *
   * Sel Jumlah yang kosong tidak mengubah pos itu, dan sel Catatan yang kosong
   * tidak menghapus catatan yang ada. Baris yang ditulis ditandai
   * source = 'import'. Periode non-draft ditolak trigger seperti biasa.
   */
  importExcel: async ({ locals, params, request }) => {
    if (!canEnterReports(locals.role)) {
      return fail(403, { message: 'Laporan diisi oleh staf entitas.' });
    }

    const form = await request.formData();
    const target = await resolvePeriod(locals, params.period, String(form.get('entitas') ?? ''));
    if (!target.ok) return fail(target.status, { message: target.message });

    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return fail(400, { message: 'Pilih file Excel (.xlsx) terlebih dahulu.' });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return fail(400, { message: 'File terlalu besar. Batasnya 2 MB.' });
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      return fail(400, { message: 'Hanya file .xlsx yang diterima. Simpan ulang file sebagai Excel Workbook.' });
    }

    const parsed = await parseWorkbook(await file.arrayBuffer());
    if (!parsed.ok) return fail(400, { message: parsed.message });

    if (parsed.meta && (parsed.meta.entity !== target.entityCode || parsed.meta.month !== params.period)) {
      return fail(409, {
        message: `File ini untuk ${parsed.meta.entity} ${parsed.meta.month}, bukan ${target.entityCode} ${params.period}. Unduh template dari periode yang benar.`
      });
    }

    const { data: templateLines, error: templateError } = await locals.supabase
      .from('report_template_lines')
      .select('line_code')
      .eq('template_id', target.templateId)
      .eq('is_active', true)
      .returns<{ line_code: string }[]>();
    if (templateError) {
      return fail(500, { message: explain('report_template_lines', templateError, 'Gagal memuat template laporan.') });
    }

    const known = new Set((templateLines ?? []).map((l) => l.line_code));
    const unknown = parsed.rows.filter((r) => !known.has(r.line_code));
    if (unknown.length > 0) {
      return fail(409, {
        message:
          'Ada kode pos yang tidak ada di template periode ini, jadi tidak ada baris yang ditulis: ' +
          unknown.map((r) => `${r.line_code} (baris ${r.row})`).join(', ') +
          '.'
      });
    }

    const seen = new Map<string, number>();
    for (const r of parsed.rows) {
      if (seen.has(r.line_code)) {
        return fail(409, {
          message: `Kode ${r.line_code} muncul dua kali (baris ${seen.get(r.line_code)} dan ${r.row}). Tidak ada baris yang ditulis.`
        });
      }
      seen.set(r.line_code, r.row);
    }

    const filled = parsed.rows.filter((r) => r.amount !== null);
    const oversized = filled.find((r) => Math.abs(Number(r.amount)) >= AMOUNT_LIMIT);
    if (oversized) {
      return fail(400, { message: `Nominal pada ${oversized.line_code} (baris ${oversized.row}) terlalu besar.` });
    }
    if (filled.length === 0) {
      return fail(400, { message: 'Kolom Jumlah di file masih kosong semua. Tidak ada yang diimpor.' });
    }

    /**
     * Pos yang angka dan catatannya sama dengan yang tersimpan tidak ditulis.
     * Template berisi angka yang sudah ada; menulis ulang semuanya akan
     * mengganti tanda 'operasional' hasil tarik data menjadi 'import' dan
     * mengisi audit_log dengan perubahan yang tidak mengubah apa pun.
     */
    const { data: stored, error: storedError } = await locals.supabase
      .from('report_lines')
      .select('line_code, amount, note')
      .eq('period_id', target.periodId)
      .returns<{ line_code: string; amount: Numeric; note: string | null }[]>();
    if (storedError) {
      return fail(500, { message: explain('report_lines read', storedError, 'Gagal membaca laporan yang tersimpan.') });
    }
    const current = new Map((stored ?? []).map((s) => [s.line_code, s]));
    const sameCents = (a: Numeric, b: string) => Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
    const changed = filled.filter((r) => {
      const s = current.get(r.line_code);
      if (!s) return true;
      return !sameCents(s.amount, r.amount!) || (r.note !== null && r.note !== s.note);
    });

    /**
     * Dua upsert, bukan satu: baris yang membawa catatan dan baris yang tidak.
     * Dalam satu upsert, kolom yang tidak dikirim satu baris akan diisi NULL
     * untuk baris itu, dan catatan yang sudah ditulis staf ikut terhapus.
     */
    const base = (r: (typeof filled)[number]) => ({
      period_id: target.periodId,
      line_code: r.line_code,
      amount: r.amount,
      source: 'import'
    });
    const withNote = changed.filter((r) => r.note !== null).map((r) => ({ ...base(r), note: r.note }));
    const withoutNote = changed.filter((r) => r.note === null).map(base);

    for (const batch of [withNote, withoutNote]) {
      if (batch.length === 0) continue;
      const { error: writeError } = await locals.supabase
        .from('report_lines')
        .upsert(batch, { onConflict: 'period_id,line_code' });
      if (writeError) {
        return fail(400, { message: explain('report_lines import', writeError, 'Gagal menulis baris dari file Excel.') });
      }
    }

    const state = await stillDraft(locals.supabase, target.periodId);
    if (!state.draft) return fail(409, { message: state.message });

    return {
      imported: changed.length,
      unchanged: filled.length - changed.length,
      skipped: parsed.rows.length - filled.length,
      fileName: file.name
    };
  },

  saveDraft: async ({ locals, params, request }) => {
    const form = await request.formData();
    const target = await resolvePeriod(locals, params.period, String(form.get('entitas') ?? ''));
    if (!target.ok) return fail(target.status, { message: target.message });

    const lines = collectLines(form);
    const oversized = tooLarge(lines);
    if (oversized) {
      return fail(400, {
        message: `Nominal ${formatAmount(oversized.amount)} pada ${oversized.line_code} terlalu besar untuk disimpan.`
      });
    }

    const writeError = await writeLines(locals.supabase, target.periodId, lines);
    if (writeError) {
      return fail(400, {
        message: explain('report_lines write', writeError, 'Gagal menyimpan baris laporan.')
      });
    }

    const state = await stillDraft(locals.supabase, target.periodId);
    if (!state.draft) return fail(409, { message: state.message });

    return { saved: true };
  },

  submit: async ({ locals, params, request }) => {
    if (!locals.user) redirect(303, '/login');

    const form = await request.formData();
    const target = await resolvePeriod(locals, params.period, String(form.get('entitas') ?? ''));
    if (!target.ok) return fail(target.status, { message: target.message });

    const lines = collectLines(form);
    const oversized = tooLarge(lines);
    if (oversized) {
      return fail(400, {
        message: `Nominal ${formatAmount(oversized.amount)} pada ${oversized.line_code} terlalu besar untuk disimpan.`
      });
    }

    // Save first: submitting is a transition on top of whatever is on screen,
    // and the lines stop being writable the moment the status changes.
    const writeError = await writeLines(locals.supabase, target.periodId, lines);
    if (writeError) {
      return fail(400, {
        message: explain('report_lines write', writeError, 'Gagal menyimpan baris laporan.')
      });
    }

    const state = await stillDraft(locals.supabase, target.periodId);
    if (!state.draft) return fail(409, { message: state.message });

    /**
     * `submitted_by` goes in the same UPDATE as the status, and it has to.
     * `guard_period_transition` requires it to equal `auth.uid()`, and the
     * approval screen later reads it to enforce that a submitter cannot
     * approve their own submission (invariant 6). Filling it in afterwards
     * would leave a submitted period with no submitter, which is the hole
     * that check used to have.
     */
    const { data: updated, error: transitionError } = await locals.supabase
      .from('periods')
      .update({
        status: 'submitted',
        submitted_by: locals.user.id,
        submitted_at: new Date().toISOString()
      })
      .eq('id', target.periodId)
      .select('status')
      .maybeSingle<{ status: PeriodStatus }>();

    if (transitionError) {
      return fail(400, {
        message: explain('periods transition', transitionError, 'Gagal mengajukan laporan.')
      });
    }
    // An UPDATE the USING clause refuses returns no row and no error.
    if (!updated) {
      return fail(403, { message: 'Pengajuan ditolak. Muat ulang halaman dan coba lagi.' });
    }

    redirect(
      303,
      `/entry?entitas=${encodeURIComponent(target.entityCode)}&terkirim=${params.period}`
    );
  }
};
