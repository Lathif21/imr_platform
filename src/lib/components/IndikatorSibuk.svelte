<script lang="ts">
  /**
   * Shows that something the user started is still running: the progress
   * cursor (arrow + spinner) everywhere on the page, and a thin bar along the
   * top edge — the bar is what phones get, since they have no cursor.
   *
   * Covers page navigation (`navigating`) and every fetch the user is
   * waiting on — saves, deletes, imports, Excel exports (`$lib/sibuk`).
   *
   * Two delays keep it calm:
   *   MUNCUL  nothing shows for work that finishes faster than a blink,
   *           so most navigations on the VPS never flash it at all;
   *   TAHAN   after a save, SvelteKit reloads the page data in a second
   *           request the counter does not see — holding briefly keeps the
   *           cursor from dropping and coming back in between.
   */
  import { onMount } from 'svelte';
  import { navigating } from '$app/state';
  import { pantauFetch, pantauUnduhan, sibuk } from '$lib/sibuk.svelte';

  const MUNCUL = 150;
  const TAHAN = 200;

  const berjalan = $derived(navigating.to !== null || sibuk.aktif);
  let tampil = $state(false);

  $effect(() => {
    const jeda = setTimeout(() => (tampil = berjalan), berjalan ? MUNCUL : TAHAN);
    return () => clearTimeout(jeda);
  });

  $effect(() => {
    document.documentElement.toggleAttribute('data-sibuk', tampil);
  });

  onMount(() => {
    pantauFetch();
    return pantauUnduhan();
  });
</script>

{#if tampil}
  <div class="sibuk-bar" role="progressbar" aria-label="Sedang memproses" aria-busy="true"></div>
{/if}

<style>
  /* Wins over every `cursor-pointer` and `cursor-text` underneath. */
  :global(html[data-sibuk]),
  :global(html[data-sibuk] *) {
    cursor: progress !important;
  }

  .sibuk-bar {
    position: fixed;
    inset: 0 0 auto 0;
    height: 2px;
    z-index: 9999;
    overflow: hidden;
    pointer-events: none;
    background: color-mix(in srgb, var(--color-primary) 20%, transparent);
  }

  .sibuk-bar::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 40%;
    background: var(--color-primary);
    animation: sibuk-geser 1.1s ease-in-out infinite;
  }

  @keyframes sibuk-geser {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(250%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sibuk-bar::before {
      animation: none;
      width: 100%;
      opacity: 0.6;
    }
  }
</style>
