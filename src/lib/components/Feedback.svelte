<script lang="ts">
  import CircleCheck from 'lucide-svelte/icons/circle-check';
  import CircleAlert from 'lucide-svelte/icons/circle-alert';
  import Info from 'lucide-svelte/icons/info';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import X from 'lucide-svelte/icons/x';
  import { fade, fly, scale } from 'svelte/transition';
  import {
    closeNotice,
    confirmState,
    dismissToast,
    noticeState,
    settleConfirm,
    toasts
  } from '$lib/feedback.svelte';

  let confirmButton = $state<HTMLButtonElement | null>(null);
  let noticeButton = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (confirmState.open) confirmButton?.focus();
  });

  // Focus on the one button, so Enter or Space closes the notice — the
  // keyboard path the operational system's modals had, and the reason a
  // result modal costs nothing to dismiss.
  $effect(() => {
    if (noticeState.open) noticeButton?.focus();
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (confirmState.open) settleConfirm(false);
    else if (noticeState.open) closeNotice();
  }

  const TOAST_STYLE = {
    success: 'border-positive/40 text-positive',
    error: 'border-destructive/40 text-destructive',
    info: 'border-primary/40 text-primary'
  } as const;
</script>

<svelte:window {onkeydown} />

<!-- toasts · bottom-right, above the sticky footers -->
<div
  class="fixed z-[60] bottom-20 right-4 left-4 sm:left-auto sm:w-[360px] flex flex-col gap-2 pointer-events-none"
  aria-live="polite"
>
  {#each toasts as t (t.id)}
    <div
      in:fly={{ y: 12, duration: 180 }}
      out:fade={{ duration: 150 }}
      role={t.kind === 'error' ? 'alert' : 'status'}
      class="pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover shadow-lg px-3.5 py-3 {TOAST_STYLE[t.kind]}"
    >
      {#if t.kind === 'success'}
        <CircleCheck size={16} class="shrink-0 mt-0.5" />
      {:else if t.kind === 'error'}
        <CircleAlert size={16} class="shrink-0 mt-0.5" />
      {:else}
        <Info size={16} class="shrink-0 mt-0.5" />
      {/if}
      <div class="flex-1 min-w-0">
        <p class="text-[13px] font-semibold">{t.title}</p>
        {#if t.message}
          <p class="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{t.message}</p>
        {/if}
      </div>
      <button
        type="button"
        onclick={() => dismissToast(t.id)}
        aria-label="Tutup notifikasi"
        class="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted
               transition-colors cursor-pointer"
      >
        <X size={14} />
      </button>
    </div>
  {/each}
</div>

<!--
  result notice · success or error

  The backdrop does not close it. A stray click beside an error would make
  the explanation vanish before it was read — the operational system set
  allowOutsideClick: false on its result modals for the same reason. The
  button, Enter, and Escape all close it.
-->
{#if noticeState.open && noticeState.options}
  {@const n = noticeState.options}
  {@const success = noticeState.kind === 'success'}
  <div
    class="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50"
    transition:fade={{ duration: 120 }}
    role="presentation"
  >
    <div
      role={success ? 'dialog' : 'alertdialog'}
      aria-modal="true"
      aria-labelledby="notice-title"
      aria-describedby={n.message ? 'notice-message' : undefined}
      transition:scale={{ start: 0.96, duration: 140 }}
      class="w-full max-w-[420px] rounded-xl border border-border bg-popover shadow-2xl p-6 text-center"
    >
      <div
        class="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center
               {success ? 'bg-positive/15 text-positive' : 'bg-destructive/15 text-destructive'}"
      >
        {#if success}
          <CircleCheck size={26} />
        {:else}
          <CircleAlert size={26} />
        {/if}
      </div>

      <h2 id="notice-title" class="text-[16px] font-semibold text-foreground">{n.title}</h2>
      {#if n.message}
        <p id="notice-message" class="text-[13px] text-muted-foreground mt-2 leading-relaxed">
          {n.message}
        </p>
      {/if}

      {#if n.details && n.details.length > 0}
        <ul
          class="mt-4 text-left rounded-lg border px-4 py-3 space-y-1.5 max-h-[40vh] overflow-y-auto
                 {success
            ? 'border-border bg-card'
            : 'border-destructive/25 bg-destructive/10'}"
        >
          {#each n.details as detail, i (i)}
            <li
              class="text-[12px] leading-relaxed flex gap-2
                     {success ? 'text-foreground' : 'text-destructive font-medium'}"
            >
              <span aria-hidden="true" class="shrink-0">•</span>
              <span>{detail}</span>
            </li>
          {/each}
        </ul>
      {/if}

      <button
        type="button"
        bind:this={noticeButton}
        onclick={closeNotice}
        class="mt-5 w-full sm:w-auto sm:min-w-[140px] px-5 py-2 rounded-lg text-[13px] font-medium
               text-primary-foreground active:scale-[0.98] transition-all cursor-pointer
               focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
               focus-visible:ring-offset-popover
               {success
          ? 'bg-primary hover:bg-accent focus-visible:ring-primary'
          : 'bg-destructive hover:brightness-110 focus-visible:ring-destructive'}"
      >
        {n.buttonLabel ?? (success ? 'Selesai' : 'Mengerti')}
      </button>
    </div>
  </div>
{/if}

<!-- confirmation dialog -->
{#if confirmState.open && confirmState.options}
  {@const o = confirmState.options}
  <div
    class="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50"
    transition:fade={{ duration: 120 }}
    onclick={(e) => e.target === e.currentTarget && settleConfirm(false)}
    role="presentation"
  >
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      transition:scale={{ start: 0.96, duration: 140 }}
      class="w-full max-w-[420px] rounded-xl border border-border bg-popover shadow-2xl p-5"
    >
      <h2 id="confirm-title" class="text-[15px] font-semibold text-foreground">{o.title}</h2>
      <p id="confirm-message" class="text-[13px] text-muted-foreground mt-2 leading-relaxed">
        {o.message}
      </p>
      {#if o.consequence}
        <div
          class="mt-3 flex gap-2.5 rounded-lg border px-3 py-2.5
                 {o.tone === 'danger'
            ? 'border-destructive/25 bg-destructive/10 text-destructive'
            : 'border-warning/30 bg-warning/10 text-warning'}"
        >
          <TriangleAlert size={15} class="shrink-0 mt-0.5" />
          <p class="text-[12px] font-medium leading-relaxed">{o.consequence}</p>
        </div>
      {/if}
      <div class="flex justify-end gap-2 mt-5">
        <button
          type="button"
          onclick={() => settleConfirm(false)}
          class="px-4 py-2 rounded-lg border border-border bg-card text-[13px] font-medium
                 text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border-strong
                 active:scale-[0.98] transition-all cursor-pointer"
        >
          {o.cancelLabel ?? 'Batal'}
        </button>
        <button
          type="button"
          bind:this={confirmButton}
          onclick={() => settleConfirm(true)}
          class="px-4 py-2 rounded-lg text-[13px] font-medium text-primary-foreground
                 active:scale-[0.98] transition-all cursor-pointer focus:outline-none focus-visible:ring-2
                 focus-visible:ring-offset-2 focus-visible:ring-offset-popover
                 {o.tone === 'danger'
            ? 'bg-destructive hover:brightness-110 focus-visible:ring-destructive'
            : 'bg-primary hover:bg-accent focus-visible:ring-primary'}"
        >
          {o.confirmLabel ?? 'Ya, lanjutkan'}
        </button>
      </div>
    </div>
  </div>
{/if}
