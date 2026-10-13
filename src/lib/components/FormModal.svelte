<script lang="ts">
  /**
   * A form in a dialog — the operational system's create/edit pattern. The
   * form itself is the caller's; this is only the frame.
   *
   * Sits below the feedback layer (z-50 against z-60/70), so a refusal shows
   * on top of the form it refers to, and Escape is ignored while a notice or
   * a question is open: one Escape should close the error, not throw away
   * everything the user typed underneath it.
   */
  import X from 'lucide-svelte/icons/x';
  import { fade, scale } from 'svelte/transition';
  import { confirmState, noticeState } from '$lib/feedback.svelte';

  let {
    open = $bindable(false),
    title,
    /** Wider for forms with two columns of fields. */
    wide = false,
    children
  }: {
    open?: boolean;
    title: string;
    wide?: boolean;
    children: import('svelte').Snippet;
  } = $props();

  let panel = $state<HTMLDivElement | null>(null);

  // First field gets focus, so the keyboard user starts typing at once.
  $effect(() => {
    if (open) {
      queueMicrotask(() =>
        panel?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')?.focus()
      );
    }
  });

  function onkeydown(event: KeyboardEvent) {
    if (!open || event.key !== 'Escape') return;
    if (noticeState.open || confirmState.open) return;
    open = false;
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/50 overflow-y-auto"
    transition:fade={{ duration: 120 }}
    role="presentation"
  >
    <div
      bind:this={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="form-modal-title"
      transition:scale={{ start: 0.97, duration: 140 }}
      class="w-full {wide ? 'max-w-[640px]' : 'max-w-[440px]'} my-8 rounded-xl border border-border
             bg-popover shadow-2xl"
    >
      <div class="h-12 flex items-center justify-between gap-3 px-5 border-b border-border">
        <h2 id="form-modal-title" class="text-[15px] font-semibold text-foreground truncate">
          {title}
        </h2>
        <button
          type="button"
          onclick={() => (open = false)}
          aria-label="Tutup"
          class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={15} />
        </button>
      </div>
      <div class="p-5">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
