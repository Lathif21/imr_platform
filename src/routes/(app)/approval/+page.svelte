<script lang="ts">
  import Check from 'lucide-svelte/icons/check';
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ChevronUp from 'lucide-svelte/icons/chevron-up';
  import Lock from 'lucide-svelte/icons/lock';
  import LockOpen from 'lucide-svelte/icons/lock-open';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import Undo2 from 'lucide-svelte/icons/undo-2';
  import X from 'lucide-svelte/icons/x';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import {
    PERIOD_STATUS_LABEL,
    REPORTING_BASIS_LABEL,
    REVENUE_PRESENTATION_LABEL,
    type Numeric,
    type PeriodStatus
  } from '$lib/domain';
  import {
    NO_DATA,
    formatAmount,
    formatDate,
    formatDelta,
    formatDeltaPoints,
    formatPct,
    formatPeriod,
    momPct,
    previousPeriod
  } from '$lib/format';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  /**
   * Badge colours follow `statusConfig` in the Figma export's ApprovalScreen,
   * expressed in tokens rather than the export's raw hex.
   */
  const STATUS_CLASS: Record<PeriodStatus, string> = {
    draft: 'bg-muted border-border text-muted-foreground',
    submitted: 'bg-primary/10 border-primary/40 text-primary',
    approved: 'bg-positive/10 border-positive/40 text-positive',
    locked: 'bg-card border-border-strong text-foreground'
  };

  /**
   * The status word alone ("Draft") does not tell a director whether anything
   * is expected of them. The second line does.
   */
  const STATUS_HINT: Record<PeriodStatus, string> = {
    draft: 'Belum diajukan entitas',
    submitted: 'Menunggu persetujuan',
    approved: 'Masuk konsolidasi',
    locked: 'Final, tidak bisa diubah'
  };

  const monthLabel = $derived(data.month ? formatPeriod(`${data.month}-01`) : '');
  const previousLabel = $derived(
    data.month ? formatPeriod(previousPeriod(`${data.month}-01`)) : ''
  );

  /** `data.months` is newest first, so "earlier" is the next index. */
  const monthIndex = $derived(data.months.findIndex((option) => option.month === data.month));
  const earlierMonth = $derived(monthIndex >= 0 ? (data.months[monthIndex + 1] ?? null) : null);
  const laterMonth = $derived(monthIndex > 0 ? data.months[monthIndex - 1] : null);

  /** What this reviewer can act on right now — the first thing they look for. */
  const waiting = $derived(
    data.canApprove
      ? data.rows.filter(
          (row) => row.period?.status === 'submitted' && row.period.submitted_by !== data.userId
        ).length
      : 0
  );

  /** Legal names for the completeness banner; the view returns codes. */
  const missingNames = $derived(
    (data.completeness?.missing_entities ?? []).map(
      (code) => data.rows.find((row) => row.entity.code === code)?.entity.legal_name ?? code
    )
  );

  /** Keeps ?periode= while toggling a panel, and vice versa. */
  function panelHref(periodId: string | null): string {
    const params = new URLSearchParams();
    if (data.month) params.set('periode', data.month);
    if (periodId && data.expandedId !== periodId) params.set('buka', periodId);
    return `?${params.toString()}`;
  }

  /**
   * "Tolak" and "Buka Kunci" in the action column are not disclosure toggles.
   * Both need a written note, so both open the panel — but a toggle made them
   * look broken twice over: the panel renders several hundred pixels below the
   * row (locked periods sort last, so the row is at the bottom of the table)
   * and nothing scrolled, so the first click did nothing visible; the second
   * click then closed the panel again. This href always opens, and the hash
   * says which control the reviewer actually pressed for.
   */
  function actionHref(periodId: string, field: 'note'): string {
    const params = new URLSearchParams();
    if (data.month) params.set('periode', data.month);
    params.set('buka', periodId);
    return `?${params.toString()}#${field}-${periodId}`;
  }

  /**
   * Bring the freshly opened panel into view. The page scrolls in an inner
   * container, not the window, so neither the browser's own hash handling nor
   * SvelteKit's scroll restoration lands on it.
   */
  $effect(() => {
    const id = data.expandedId;
    if (!id) return;
    const wantsNote = page.url.hash === `#note-${id}`;
    const note = wantsNote ? document.getElementById(`note-${id}`) : null;
    const target = note ?? document.getElementById(`panel-${id}`);
    target?.scrollIntoView({ block: note ? 'center' : 'nearest', behavior: 'smooth' });
    // Focus last: the caret belongs in the note, not wherever the link was.
    (note as HTMLTextAreaElement | null)?.focus({ preventScroll: true });
  });

  type CompareRow = {
    label: string;
    current: Numeric | null;
    prior: Numeric | null;
    /** A margin is a ratio; its change is in points, not in percent. */
    ratio?: boolean;
  };

  /**
   * Straight out of `v_period_pnl`. Gross profit, operating result and net
   * profit are not recomputed here (invariant 2) — the view is the one place
   * that arithmetic happens, so the reviewer and the consolidation can never
   * be looking at two different answers.
   */
  function compareRows(row: PageData['rows'][number]): CompareRow[] {
    const now = row.pnl;
    const before = row.previous;
    return [
      { label: 'Pendapatan', current: now?.revenue ?? null, prior: before?.revenue ?? null },
      { label: 'Beban Pokok', current: now?.cogs ?? null, prior: before?.cogs ?? null },
      { label: 'Laba Kotor', current: now?.gross_profit ?? null, prior: before?.gross_profit ?? null },
      { label: 'Beban Usaha', current: now?.opex ?? null, prior: before?.opex ?? null },
      { label: 'Laba Bersih', current: now?.net_profit ?? null, prior: before?.net_profit ?? null },
      {
        label: 'Margin Bersih',
        current: now?.net_margin_pct ?? null,
        prior: before?.net_margin_pct ?? null,
        ratio: true
      }
    ];
  }

  /**
   * Approving is reversible, but a click that lands on the wrong row is easy
   * at this size of table, and the confirmation names the entity so the
   * director can see which one they are signing off.
   */
  function confirmApprove(event: MouseEvent, entityName: string) {
    const ok = confirm(`Setujui laporan ${entityName} untuk ${monthLabel}?`);
    if (!ok) event.preventDefault();
  }

  function confirmLock(event: MouseEvent) {
    const ok = confirm(
      'Kunci periode ini? Setelah terkunci hanya direksi yang dapat membukanya kembali.'
    );
    if (!ok) event.preventDefault();
  }

  function confirmUnlock(event: MouseEvent) {
    const ok = confirm(
      'Buka kunci periode ini? Periode kembali ke draft, keluar dari angka konsolidasi, dan tindakan ini tercatat di audit log.'
    );
    if (!ok) event.preventDefault();
  }
</script>

<svelte:head><title>Persetujuan Laporan · IMR Platform</title></svelte:head>

<div class="flex flex-col h-full overflow-hidden">
  <!-- header · 56px -->
  <div class="h-14 flex items-center justify-between px-4 sm:px-6 border-b border-border shrink-0 gap-3">
    <div class="flex items-center gap-3 min-w-0">
      <h1 class="text-[18px] font-semibold text-foreground truncate">Persetujuan Laporan</h1>
      {#if !data.canApprove}
        <span class="text-[14px] text-muted-foreground truncate hidden sm:inline">
          Hanya baca — peran Anda tidak menyetujui laporan
        </span>
      {/if}
    </div>
  </div>

  {#if !data.month}
    <div class="flex-1 p-4 sm:p-6">
      <div class="max-w-[560px] bg-card border border-border rounded-lg p-6">
        <h2 class="text-[17px] font-semibold text-foreground mb-2">Belum ada periode</h2>
        <p class="text-[15px] text-muted-foreground leading-relaxed">
          Belum ada satu pun periode pelaporan yang dibuat, jadi tidak ada yang menunggu
          persetujuan.
        </p>
      </div>
    </div>
  {:else}
    <div class="flex-1 overflow-y-auto">
      <div class="p-4 sm:p-6 pb-0 space-y-4">
        <!-- Month picker. It used to be a bare dropdown in the header's far
             corner with no label, where directors did not recognise it as a
             control at all. It now sits first in the content with a label,
             and the arrows step one month without opening the list. -->
        <form method="GET" class="flex flex-wrap items-center gap-2">
          <label for="periode" class="text-[16px] font-medium text-foreground mr-1">
            Periode laporan
          </label>
          {#if earlierMonth}
            <a
              href="?periode={earlierMonth.month}"
              class="h-11 px-3 inline-flex items-center gap-1 rounded-lg border border-border-strong bg-background
                     text-[15px] font-medium text-foreground hover:bg-muted transition-colors"
              title="Bulan sebelumnya: {formatPeriod(earlierMonth.period)}"
            >
              <ChevronLeft size={18} />
              <span class="hidden sm:inline">Sebelumnya</span>
            </a>
          {/if}
          <select
            id="periode"
            name="periode"
            class="h-11 min-w-[200px] pl-4 pr-3 bg-background border-2 border-primary/60 rounded-lg text-[16px]
                   font-semibold text-foreground tabular-nums hover:border-primary transition-colors
                   focus:outline-none focus:border-primary cursor-pointer"
            onchange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {#each data.months as option (option.period)}
              <option value={option.month} selected={option.month === data.month}>
                {formatPeriod(option.period)}
              </option>
            {/each}
          </select>
          {#if laterMonth}
            <a
              href="?periode={laterMonth.month}"
              class="h-11 px-3 inline-flex items-center gap-1 rounded-lg border border-border-strong bg-background
                     text-[15px] font-medium text-foreground hover:bg-muted transition-colors"
              title="Bulan berikutnya: {formatPeriod(laterMonth.period)}"
            >
              <span class="hidden sm:inline">Berikutnya</span>
              <ChevronRight size={18} />
            </a>
          {/if}
          <noscript>
            <button
              type="submit"
              class="h-11 px-4 bg-primary text-primary-foreground rounded-lg text-[15px] font-medium"
            >
              Tampilkan
            </button>
          </noscript>
        </form>

        {#if data.canApprove}
          <p
            class="text-[17px] font-semibold {waiting > 0 ? 'text-primary' : 'text-muted-foreground'}"
          >
            {#if waiting > 0}
              {waiting} laporan menunggu persetujuan Anda
            {:else}
              Tidak ada laporan yang menunggu persetujuan Anda untuk {monthLabel}.
            {/if}
          </p>
        {/if}

        <!-- Completeness, same rule as the dashboard: a group figure computed
             while entities are missing is a different number, never a smaller
             one. It is never shown without saying so. -->
        {#if data.completeness}
          {@const complete = data.completeness.is_complete}
          <div
            class="flex items-start gap-3 px-4 py-3 rounded-lg border {complete
              ? 'bg-positive/10 border-positive/40'
              : 'bg-warning/10 border-warning/40'}"
            role="status"
          >
            {#if complete}
              <Check size={20} class="text-positive shrink-0 mt-0.5" />
              <p class="text-[16px] text-positive flex-1 leading-relaxed">
                {data.completeness.reported_entities} dari {data.completeness.expected_entities}
                entitas sudah disetujui — {monthLabel} lengkap.
              </p>
            {:else}
              <TriangleAlert size={20} class="text-warning shrink-0 mt-0.5" />
              <p class="text-[16px] text-warning flex-1 leading-relaxed">
                <span class="font-semibold">
                  {data.completeness.reported_entities} dari {data.completeness.expected_entities}
                  entitas sudah disetujui.
                </span>
                {#if missingNames.length > 0}
                  Belum disetujui: {missingNames.join(', ')}.
                {/if}
              </p>
            {/if}
          </div>
        {/if}

        {#if form?.message}
          <div
            class="px-4 py-3 bg-destructive/10 border border-destructive/40 rounded-lg"
            role="alert"
          >
            <p class="text-[16px] text-destructive leading-relaxed">{form.message}</p>
          </div>
        {:else if form?.done}
          <div class="px-4 py-3 bg-positive/10 border border-positive/40 rounded-lg" role="status">
            <p class="text-[16px] text-positive leading-relaxed">
              {#if form.done === 'approve'}
                Periode disetujui dan masuk ke angka konsolidasi.
              {:else if form.done === 'reject'}
                Periode dikembalikan ke draft. Catatan Anda tampil di layar input Admin Operasional.
              {:else if form.done === 'lock'}
                Periode dikunci. Hanya direksi yang dapat membukanya.
              {:else}
                Kunci dibuka. Periode kembali ke draft dan keluar dari angka konsolidasi.
              {/if}
            </p>
          </div>
        {/if}

        <p class="text-[15px] text-muted-foreground">
          Klik <span class="font-semibold text-foreground">Lihat angka</span> pada sebuah baris
          untuk melihat angka laporannya sebelum menyetujui.
        </p>
      </div>

      <!-- Six columns of dates, names and statuses do not fit a phone, and
           squeezing them turns every cell into two words a line. It scrolls
           sideways inside its own box instead — the page itself never does. -->
      <div class="overflow-x-auto">
        <table class="w-full min-w-[1080px] border-collapse mt-3">
        <thead>
          <tr class="border-b-2 border-border">
            <!-- The other five columns are fixed, so without a floor this one
                 takes whatever is left — 120px on a phone, which wraps every
                 legal name onto four lines. -->
            <th
              class="py-3 px-4 sm:px-6 text-left text-[15px] font-semibold text-muted-foreground min-w-[240px]"
            >
              Entitas
            </th>
            <th class="py-3 px-4 text-left text-[15px] font-semibold text-muted-foreground w-[200px]">
              Status
            </th>
            <th class="py-3 px-4 text-left text-[15px] font-semibold text-muted-foreground w-[170px]">
              Diajukan Oleh
            </th>
            <th class="py-3 px-4 text-left text-[15px] font-semibold text-muted-foreground w-[140px]">
              Tanggal Diajukan
            </th>
            <th class="py-3 px-4 sm:px-6 text-right text-[15px] font-semibold text-muted-foreground w-[400px]">
              Tindakan
            </th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as row (row.entity.id)}
            {@const open = row.period !== null && row.period.id === data.expandedId}
            {@const isSubmitter =
              row.period?.submitted_by !== null && row.period?.submitted_by === data.userId}
            <tr class="border-b border-border {open ? 'bg-card' : 'hover:bg-card/60'} transition-colors">
              <td class="py-4 px-4 sm:px-6">
                <span
                  class="flex items-center gap-2.5 text-[16px] font-semibold
                         {row.period ? 'text-foreground' : 'text-muted-foreground'}"
                >
                  <span
                    class="w-2.5 h-2.5 rounded-full shrink-0"
                    style:background-color={row.entity.theme_color}
                  ></span>
                  {row.entity.legal_name}
                </span>
              </td>

              <td class="py-4 px-4">
                {#if row.period}
                  <span
                    class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[15px] font-semibold
                           {STATUS_CLASS[row.period.status]}"
                  >
                    {#if row.period.status === 'locked'}<Lock size={14} />{/if}
                    {#if row.period.status === 'approved'}<Check size={14} />{/if}
                    {PERIOD_STATUS_LABEL[row.period.status]}
                  </span>
                  <p class="mt-1 text-[14px] text-muted-foreground">
                    {STATUS_HINT[row.period.status]}
                  </p>
                {:else}
                  <!-- An entity that has not started has to look like one. -->
                  <span
                    class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[15px] font-semibold
                           bg-warning/10 border-warning/40 text-warning"
                  >
                    <TriangleAlert size={14} />
                    Belum ada laporan
                  </span>
                  <p class="mt-1 text-[14px] text-muted-foreground">Entitas belum mulai mengisi</p>
                {/if}
              </td>

              <td class="py-4 px-4 text-[16px] text-foreground truncate">
                {row.submitterName ?? NO_DATA}
              </td>

              <td class="py-4 px-4 text-[16px] text-foreground tabular-nums">
                {formatDate(row.period?.submitted_at)}
              </td>

              <td class="py-4 px-4 sm:px-6">
                <div class="flex items-center justify-end gap-2 flex-wrap">
                  {#if row.period && data.canApprove && row.period.status === 'submitted'}
                    <!-- Hidden for the submitter, and refused by the trigger
                         regardless: a hidden button is not enforcement. -->
                    {#if !isSubmitter}
                      <form method="POST" action="?/approve" use:enhance>
                        <input type="hidden" name="periodId" value={row.period.id} />
                        <input type="hidden" name="seenAt" value={row.period.submitted_at ?? ''} />
                        <button
                          type="submit"
                          onclick={(event) => confirmApprove(event, row.entity.legal_name)}
                          class="h-10 inline-flex items-center gap-1.5 px-4 bg-positive text-background
                                 text-[15px] font-semibold rounded-lg hover:opacity-90 transition-opacity"
                        >
                          <Check size={18} />
                          Setujui
                        </button>
                      </form>
                    {:else}
                      <span class="text-[14px] text-muted-foreground">
                        Anda yang mengajukan — perlu direksi/manajer lain
                      </span>
                    {/if}
                    <!-- Asks for a reason first, it does not reject on the
                         spot: the link opens the note field below. -->
                    <a
                      href={actionHref(row.period.id, 'note')}
                      title="Tulis alasan, lalu kembalikan laporan ke entitas untuk diperbaiki"
                      class="h-10 inline-flex items-center gap-1.5 px-4 border-2 border-destructive/50
                             text-destructive text-[15px] font-semibold rounded-lg hover:bg-destructive/10
                             transition-colors"
                    >
                      <X size={18} />
                      Tolak
                    </a>
                  {:else if row.period && data.canApprove && row.period.status === 'approved'}
                    <!-- An approved period can go back to draft (the trigger
                         allows it to direksi and manajer, with a note). Before
                         this link the only way was Kunci and then Buka Kunci,
                         which also needed direksi. -->
                    <a
                      href={actionHref(row.period.id, 'note')}
                      title="Tulis alasan, lalu kembalikan laporan ke draft supaya entitas bisa mengoreksi"
                      class="h-10 inline-flex items-center gap-1.5 px-4 border-2 border-border-strong
                             text-foreground text-[15px] font-semibold rounded-lg hover:bg-muted
                             transition-colors"
                    >
                      <Undo2 size={17} />
                      Batalkan persetujuan
                    </a>
                    <form method="POST" action="?/lock" use:enhance>
                      <input type="hidden" name="periodId" value={row.period.id} />
                      <input type="hidden" name="seenAt" value={row.period.approved_at ?? ''} />
                      <button
                        type="submit"
                        onclick={confirmLock}
                        title="Kunci supaya angka final dan tidak bisa diubah lagi"
                        class="h-10 inline-flex items-center gap-1.5 px-4 border-2 border-border-strong
                               text-foreground text-[15px] font-semibold rounded-lg hover:bg-muted
                               transition-colors"
                      >
                        <Lock size={17} />
                        Kunci
                      </button>
                    </form>
                  {:else if row.period && data.canUnlock && row.period.status === 'locked'}
                    <a
                      href={actionHref(row.period.id, 'note')}
                      title="Tulis alasan, lalu buka kunci supaya laporan bisa dikoreksi"
                      class="h-10 inline-flex items-center gap-1.5 px-4 border-2 border-warning/60
                             text-warning text-[15px] font-semibold rounded-lg hover:bg-warning/10
                             transition-colors"
                    >
                      <LockOpen size={17} />
                      Buka kunci
                    </a>
                  {:else if row.period?.status === 'draft'}
                    <span class="text-[14px] text-muted-foreground">
                      Menunggu entitas mengajukan
                    </span>
                  {:else if !row.period}
                    <span class="text-[14px] text-muted-foreground">Tidak ada tindakan</span>
                  {/if}

                  {#if row.period}
                    <!-- The panel toggle is a link, so it works with JavaScript
                         off and the open row survives an action and a reload.
                         It used to be only a 13px chevron beside the name,
                         which nobody recognised as a control. -->
                    <a
                      href={panelHref(row.period.id)}
                      aria-expanded={open}
                      class="h-10 inline-flex items-center gap-1.5 px-4 rounded-lg text-[15px] font-semibold
                             transition-colors {open
                        ? 'bg-primary text-primary-foreground hover:bg-accent'
                        : 'border-2 border-primary/50 text-primary hover:bg-primary/10'}"
                    >
                      {#if open}
                        Tutup
                        <ChevronUp size={18} />
                      {:else}
                        Lihat angka
                        <ChevronDown size={18} />
                      {/if}
                    </a>
                  {/if}
                </div>
              </td>
            </tr>

            {#if open && row.period}
              <tr class="border-b-2 border-border">
                <td colspan="5" class="p-0">
                  <div id="panel-{row.period.id}" class="bg-background px-4 sm:px-6 py-5 border-t border-border">
                    <div class="flex items-center justify-between gap-4 flex-wrap mb-4">
                      <p class="text-[17px] font-semibold text-foreground">
                        {row.entity.legal_name} — {monthLabel} dibandingkan {previousLabel}
                      </p>

                      <!-- A reviewer approving figures whose basis nobody has
                           agreed on needs to know that before they sign, not
                           after (ASSUMPTIONS.md A-1, A-4). -->
                      <div class="flex items-center gap-2 flex-wrap">
                        <span
                          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[14px] font-medium
                                 {row.entity.reporting_basis === 'unknown'
                            ? 'bg-warning/10 border-warning/40 text-warning'
                            : 'bg-muted border-border text-muted-foreground'}"
                        >
                          {#if row.entity.reporting_basis === 'unknown'}
                            <TriangleAlert size={14} />
                          {/if}
                          {REPORTING_BASIS_LABEL[row.entity.reporting_basis]}
                        </span>
                        <span
                          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[14px] font-medium
                                 {row.entity.revenue_presentation === 'unknown'
                            ? 'bg-warning/10 border-warning/40 text-warning'
                            : 'bg-muted border-border text-muted-foreground'}"
                        >
                          {#if row.entity.revenue_presentation === 'unknown'}
                            <TriangleAlert size={14} />
                          {/if}
                          {REVENUE_PRESENTATION_LABEL[row.entity.revenue_presentation]}
                        </span>
                      </div>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div>
                        <div class="overflow-x-auto">
                          <table class="w-full text-[16px]">
                            <thead>
                              <tr class="border-b-2 border-border">
                                <th class="pb-2 text-left text-[14px] font-semibold text-muted-foreground">Pos</th>
                                <th class="pb-2 px-3 text-right text-[14px] font-semibold text-muted-foreground">
                                  {monthLabel}
                                </th>
                                <th class="pb-2 px-3 text-right text-[14px] font-semibold text-muted-foreground">
                                  {previousLabel}
                                </th>
                                <th class="pb-2 text-right text-[14px] font-semibold text-muted-foreground">
                                  Perubahan
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {#each compareRows(row) as line (line.label)}
                                {@const change = line.ratio ? null : momPct(line.current, line.prior)}
                                <tr class="border-b border-border">
                                  <td class="py-2.5 text-foreground">{line.label}</td>
                                  <td class="py-2.5 px-3 text-right font-semibold text-foreground">
                                    {line.ratio
                                      ? formatPct(line.current, 2)
                                      : formatAmount(line.current)}
                                  </td>
                                  <td class="py-2.5 px-3 text-right text-muted-foreground">
                                    {line.ratio
                                      ? formatPct(line.prior, 2)
                                      : formatAmount(line.prior)}
                                  </td>
                                  {#if line.ratio}
                                    <!-- Points, not percent. A margin going
                                         from 1,22% to 2,08% has moved 0,86
                                         points; calling that "+70,5%" is a
                                         percentage of a percentage. -->
                                    <td class="py-2.5 text-right font-semibold text-muted-foreground">
                                      {formatDeltaPoints(line.current, line.prior)}
                                    </td>
                                  {:else if change === null}
                                    <td class="py-2.5 text-right text-subtle">{NO_DATA}</td>
                                  {:else}
                                    <td
                                      class="py-2.5 text-right font-semibold {change >= 0
                                        ? 'text-positive'
                                        : 'text-destructive'}"
                                    >
                                      {formatDelta(change)}
                                    </td>
                                  {/if}
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </div>

                        {#if !row.pnl || !row.previous}
                          <p class="mt-3 text-[15px] text-muted-foreground leading-relaxed">
                            {row.previous
                              ? 'Belum ada baris laporan untuk bulan ini.'
                              : `Tidak ada data ${previousLabel} untuk dibandingkan.`}
                          </p>
                        {/if}
                      </div>

                      <div class="flex flex-col gap-3">
                        {#if data.canApprove && row.period.status === 'submitted' && !isSubmitter}
                          <!-- The figures are on the left; the decision belongs
                               right beside them, not back up in the row. -->
                          <form method="POST" action="?/approve" use:enhance>
                            <input type="hidden" name="periodId" value={row.period.id} />
                            <input type="hidden" name="seenAt" value={row.period.submitted_at ?? ''} />
                            <button
                              type="submit"
                              onclick={(event) => confirmApprove(event, row.entity.legal_name)}
                              class="h-12 w-full inline-flex items-center justify-center gap-2 px-5 bg-positive
                                     text-background text-[17px] font-semibold rounded-lg hover:opacity-90
                                     transition-opacity"
                            >
                              <Check size={20} />
                              Setujui laporan ini
                            </button>
                          </form>
                          <p class="text-[15px] text-muted-foreground text-center">
                            — atau, jika ada yang perlu diperbaiki —
                          </p>
                        {/if}

                        {#if data.canApprove && (row.period.status === 'submitted' || row.period.status === 'approved' || (data.canUnlock && row.period.status === 'locked'))}
                          <form method="POST" class="flex flex-col gap-2 h-full" use:enhance>
                            <input type="hidden" name="periodId" value={row.period.id} />
                            <label
                              for="note-{row.period.id}"
                              class="text-[15px] font-semibold text-foreground"
                            >
                              {#if row.period.status === 'locked'}
                                Alasan membuka kunci
                              {:else if row.period.status === 'approved'}
                                Alasan membatalkan persetujuan
                              {:else}
                                Alasan penolakan
                              {/if}
                              <span class="font-normal text-muted-foreground">(wajib diisi)</span>
                            </label>
                            <textarea
                              id="note-{row.period.id}"
                              name="note"
                              required
                              placeholder={row.period.status === 'locked'
                                ? 'Tulis alasan membuka kunci...'
                                : row.period.status === 'approved'
                                  ? 'Tulis alasan membatalkan persetujuan...'
                                : 'Contoh: angka beban pokok belum sesuai nota, mohon dicek ulang.'}
                              class="flex-1 min-h-[120px] bg-background border-2 border-border-strong rounded-lg p-3
                                     text-[16px] text-foreground placeholder:text-subtle resize-y
                                     focus:outline-none focus:border-primary transition-colors"
                            ></textarea>

                            {#if row.period.status === 'submitted'}
                              <p class="text-[15px] text-muted-foreground leading-relaxed">
                                Laporan dikembalikan ke entitas sebagai draft, dan catatan ini tampil
                                di layar input Admin Operasional.
                              </p>
                              <button
                                type="submit"
                                formaction="?/reject"
                                class="self-start h-11 inline-flex items-center gap-1.5 px-5 rounded-lg
                                       border-2 border-destructive/60 bg-destructive/10 text-destructive
                                       text-[16px] font-semibold hover:bg-destructive/20 transition-colors"
                              >
                                <X size={18} />
                                Tolak & kembalikan ke entitas
                              </button>
                            {:else if row.period.status === 'approved'}
                              <p class="text-[15px] text-warning leading-relaxed">
                                Membatalkan persetujuan mengembalikan periode ke draft supaya Admin Operasional
                                entitas bisa mengoreksinya, mengeluarkannya dari angka konsolidasi,
                                dan tercatat di audit log. Catatan ini tampil di layar input.
                              </p>
                              <button
                                type="submit"
                                formaction="?/reject"
                                class="self-start h-11 inline-flex items-center gap-1.5 px-5 rounded-lg
                                       border-2 border-warning/60 bg-warning/10 text-warning
                                       text-[16px] font-semibold hover:bg-warning/20 transition-colors"
                              >
                                <Undo2 size={18} />
                                Batalkan persetujuan
                              </button>
                            {:else}
                              <p class="text-[15px] text-warning leading-relaxed">
                                Membuka kunci mengembalikan periode ke draft, mengeluarkannya dari
                                angka konsolidasi, dan tercatat di audit log.
                              </p>
                              <button
                                type="submit"
                                formaction="?/unlock"
                                onclick={confirmUnlock}
                                class="self-start h-11 inline-flex items-center gap-1.5 px-5 rounded-lg
                                       border-2 border-warning/60 bg-warning/10 text-warning text-[16px]
                                       font-semibold hover:bg-warning/20 transition-colors"
                              >
                                <LockOpen size={18} />
                                Buka kunci
                              </button>
                            {/if}
                          </form>
                        {:else}
                          <div class="text-[16px] text-muted-foreground leading-relaxed space-y-1">
                            {#if row.period.status === 'draft'}
                              <p>
                                Laporan ini masih draft — entitas belum mengajukannya, jadi belum ada
                                yang perlu Anda setujui.
                              </p>
                            {:else if row.period.status === 'approved'}
                              <p>
                                Disetujui oleh {row.approverName ?? NO_DATA} pada {formatDate(
                                  row.period.approved_at
                                )}.
                              </p>
                            {:else if row.period.status === 'locked'}
                              <p>
                                Dikunci oleh {row.lockerName ?? NO_DATA} pada {formatDate(
                                  row.period.locked_at
                                )}. Hanya direksi yang dapat membukanya.
                              </p>
                            {/if}
                            {#if !data.canApprove}
                              <p>Peran Anda hanya membaca.</p>
                            {/if}
                          </div>
                        {/if}

                        {#if row.period.rejection_note}
                          <p class="text-[15px] text-muted-foreground leading-relaxed">
                            <span class="font-semibold text-foreground">Catatan terakhir:</span>
                            {row.period.rejection_note}
                          </p>
                        {/if}
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>
