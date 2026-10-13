<script lang="ts">
  import { page } from '$app/state';

  let { children }: { children: import('svelte').Snippet } = $props();

  // The four admin screens are listed in the sidebar under the Administrasi
  // module (Sidebar.svelte). Their heading is drawn here, once, rather than in
  // each screen; a detail screen such as /admin/templates/[id] has its own.
  const screens = [
    { href: '/admin/entities', title: 'Entitas', desc: 'Badan usaha dalam grup, basis pelaporan, dan periodenya.' },
    { href: '/admin/templates', title: 'Template', desc: 'Susunan baris laporan P&L yang diisi entitas.' },
    { href: '/admin/users', title: 'Pengguna', desc: 'Akun, peran, dan entitas yang boleh diakses.' },
    { href: '/admin/pemetaan-biaya', title: 'Pemetaan Biaya', desc: 'Pos laporan untuk setiap jenis biaya dari sistem operasional.' }
  ];

  const screen = $derived(screens.find((s) => page.url.pathname === s.href));
</script>

<div class="h-full overflow-y-auto">
  {#if screen}
    <div class="px-4 sm:px-5 pt-4 sm:pt-5">
      <h1 class="text-[15px] font-semibold text-foreground">{screen.title}</h1>
      <p class="text-[12px] text-muted-foreground mt-0.5">Administrasi · {screen.desc}</p>
    </div>
  {/if}
  {@render children()}
</div>
