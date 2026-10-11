<script lang="ts">
  import Eye from 'lucide-svelte/icons/eye';
  import IdCard from 'lucide-svelte/icons/id-card';
  import Ship from 'lucide-svelte/icons/ship';
  import Truck from 'lucide-svelte/icons/truck';
  import UserRound from 'lucide-svelte/icons/user-round';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  // Port order: docs/PENGGABUNGAN.md. Kapal, transaksi, rekap, pencairan and
  // the reports join this list as they are ported — never as disabled tabs.
  const tabs = [
    { href: '/operasional/pemilik', label: 'Pemilik', icon: UserRound },
    { href: '/operasional/kendaraan', label: 'Kendaraan', icon: Truck },
    { href: '/operasional/kapal', label: 'Kapal', icon: Ship },
    { href: '/operasional/karyawan', label: 'Karyawan', icon: IdCard }
  ];

  /** Tabs carry the chosen entity along; a filter like ?pemilik does not. */
  const entityQuery = $derived(
    data.opEntity ? `?entitas=${encodeURIComponent(data.opEntity.code)}` : ''
  );

  function chooseEntity(event: Event) {
    const code = (event.currentTarget as HTMLSelectElement).value;
    goto(`${page.url.pathname}?entitas=${encodeURIComponent(code)}`);
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <div
    class="h-12 shrink-0 flex items-center gap-1 px-4 sm:px-5 border-b border-border overflow-x-auto"
  >
    <span class="text-[13px] font-semibold text-foreground mr-3 shrink-0">Operasional</span>
    {#each tabs as tab (tab.href)}
      {@const active = page.url.pathname.startsWith(tab.href)}
      <a
        href="{tab.href}{entityQuery}"
        aria-current={active ? 'page' : undefined}
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] shrink-0 transition-colors
               {active
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:bg-card hover:text-foreground'}"
      >
        <tab.icon size={13} />
        {tab.label}
      </a>
    {/each}

    <div class="ml-auto flex items-center gap-2 shrink-0 pl-3">
      {#if !data.canWrite}
        <span
          class="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-[11px]
                 text-muted-foreground"
          title="Peran Anda membaca data operasional tanpa mengubahnya."
        >
          <Eye size={12} /> Mode baca
        </span>
      {/if}
      {#if data.opEntities.length > 1}
        <label class="sr-only" for="op-entity">Entitas</label>
        <select
          id="op-entity"
          value={data.opEntity?.code}
          onchange={chooseEntity}
          class="h-[28px] px-2 bg-background border border-border rounded-md text-[12px] text-foreground
                 focus:outline-none focus:border-primary"
        >
          {#each data.opEntities as entity (entity.id)}
            <option value={entity.code}>{entity.code}</option>
          {/each}
        </select>
      {:else if data.opEntity}
        <span class="text-[12px] text-muted-foreground">{data.opEntity.code}</span>
      {/if}
    </div>
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto">
    {#if data.opEntity}
      {@render children()}
    {:else}
      <!-- No entity assigned: an administrative fix, so say who can make it. -->
      <div class="p-6 max-w-[520px]">
        <p class="text-[13px] text-foreground font-medium">Belum ada entitas yang ditautkan.</p>
        <p class="text-[12px] text-muted-foreground mt-1.5 leading-relaxed">
          Akun Anda belum ditugaskan ke entitas mana pun. Minta direksi menautkannya di
          Administrasi → Pengguna.
        </p>
      </div>
    {/if}
  </div>
</div>
