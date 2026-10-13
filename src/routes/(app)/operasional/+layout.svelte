<script lang="ts">
  import { toast } from '$lib/feedback.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  // The screen list, the entity picker and the read-only badge live in the
  // sidebar (Sidebar.svelte), so every screen is one click from any other.

  /**
   * Collaboration toasts: what other people changed in this entity since the
   * page was opened (Laravel polled every 5 s; 15 s is enough to avoid two
   * people editing the same row unaware, and quiet while the tab is hidden).
   * The page is not reloaded for them — a form being filled in would lose
   * its edits — the toast says to reload.
   */
  const POLL_MS = 15_000;
  $effect(() => {
    const code = data.opEntity?.code;
    if (!code) return;
    let kursor: number | null = null;
    let berhenti = false;

    async function ambil() {
      if (berhenti || document.visibilityState !== 'visible') return;
      try {
        const q = new URLSearchParams({ entitas: code! });
        if (kursor !== null) q.set('setelah', String(kursor));
        const res = await fetch(`/operasional/aktivitas?${q}`);
        if (!res.ok) return;
        const body = (await res.json()) as { kursor: number | null; aktivitas: { id: number; judul: string; jam: string }[] };
        if (berhenti) return;
        for (const a of body.aktivitas) toast('info', a.judul, `${a.jam} · muat ulang halaman untuk melihat perubahannya.`);
        if (body.kursor !== null) kursor = body.kursor;
      } catch {
        // Offline or server busy: the next tick tries again.
      }
    }

    void ambil();
    const timer = setInterval(ambil, POLL_MS);
    return () => {
      berhenti = true;
      clearInterval(timer);
    };
  });
</script>

<div class="flex flex-col h-full overflow-hidden">
  <div class="flex-1 min-h-0 overflow-y-auto">
    {#if data.opEntity}
      {@render children()}
    {:else}
      <!-- No entity assigned: an administrative fix, so say who can make it. -->
      <div class="p-6 max-w-[520px]">
        <p class="text-[14px] text-foreground font-medium">Belum ada entitas yang ditautkan.</p>
        <p class="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
          Akun Anda belum ditugaskan ke entitas mana pun. Minta direksi menautkannya di
          Administrasi → Pengguna.
        </p>
      </div>
    {/if}
  </div>
</div>
