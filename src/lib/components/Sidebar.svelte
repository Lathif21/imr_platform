<script lang="ts">
  import Building2 from 'lucide-svelte/icons/building-2';
  import ChartColumn from 'lucide-svelte/icons/chart-column';
  import Check from 'lucide-svelte/icons/check';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';
  import CircleCheckBig from 'lucide-svelte/icons/circle-check-big';
  import ClipboardList from 'lucide-svelte/icons/clipboard-list';
  import Database from 'lucide-svelte/icons/database';
  import Eye from 'lucide-svelte/icons/eye';
  import FileChartColumn from 'lucide-svelte/icons/file-chart-column';
  import FileSpreadsheet from 'lucide-svelte/icons/file-spreadsheet';
  import FileText from 'lucide-svelte/icons/file-text';
  import IdCard from 'lucide-svelte/icons/id-card';
  import Landmark from 'lucide-svelte/icons/landmark';
  import LayoutDashboard from 'lucide-svelte/icons/layout-dashboard';
  import LogOut from 'lucide-svelte/icons/log-out';
  import Receipt from 'lucide-svelte/icons/receipt';
  import Settings from 'lucide-svelte/icons/settings';
  import Ship from 'lucide-svelte/icons/ship';
  import Split from 'lucide-svelte/icons/split';
  import Truck from 'lucide-svelte/icons/truck';
  import UserRound from 'lucide-svelte/icons/user-round';
  import Users from 'lucide-svelte/icons/users';
  import X from 'lucide-svelte/icons/x';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import type { Theme } from '$lib/theme';
  import { ROLE_LABEL, type UserRole } from '$lib/domain';
  import {
    canApprove,
    canEnterReports,
    canReadAllEntities,
    canReadOperational,
    canReadReports,
    isDirector
  } from '$lib/roles';

  let {
    role,
    fullName,
    /** Seeds the light/dark toggle; the toggle owns it after first render. */
    theme,
    /**
     * Desktop only: 232px rail of labels, or 60px of icons. Below `md` the
     * sidebar is a drawer and this is ignored — a drawer you have opened on
     * purpose should never show you icons you cannot read.
     */
    collapsed = $bindable(false),
    /** Below `md` only. The drawer is closed until someone asks for it. */
    open = false,
    onclose
  }: {
    role: UserRole | null;
    fullName: string | null;
    theme: Theme;
    collapsed?: boolean;
    open?: boolean;
    onclose?: () => void;
  } = $props();

  type NavItem = {
    label: string;
    icon: typeof LayoutDashboard;
    href: string;
    visible?: boolean;
    /** Active only on `href` itself, not on the screens below it. */
    exact?: boolean;
    /**
     * Path prefix that counts as "you are here", when it is wider than `href`.
     */
    match?: string;
  };

  type NavGroup = { heading?: string; items: NavItem[] };

  type ModuleKey = 'keuangan' | 'operasional' | 'admin';

  type Module = {
    key: ModuleKey;
    label: string;
    description: string;
    icon: typeof LayoutDashboard;
    groups: NavGroup[];
  };

  /**
   * One sidebar, one module at a time. The module switcher sits on the logo at
   * the top — the place every admin tool keeps it — and the screens of the
   * chosen module are listed right below, so no screen is ever more than one
   * click away and there is no second row of tabs to look for.
   *
   * `visible` is UX only. Hiding a nav item is not access control — RLS is.
   */
  const modules = $derived<Module[]>([
    {
      key: 'keuangan',
      label: 'Keuangan',
      description: 'Laporan P&L entitas',
      icon: FileText,
      groups: [
        {
          items: [
            {
              label: 'Dasbor Eksekutif',
              icon: LayoutDashboard,
              href: '/',
              exact: true,
              // Consolidated figures are group figures. Since manajer
              // became entity-scoped, only direksi can be shown a
              // group total.
              visible: canReadAllEntities(role)
            },
            { label: 'Laporan P&L', icon: FileText, href: '/entities', visible: canReadReports(role) },
            { label: 'Input Laporan', icon: ClipboardList, href: '/entry', visible: canEnterReports(role) },
            { label: 'Persetujuan', icon: CircleCheckBig, href: '/approval', visible: canApprove(role) }
          ]
        }
      ]
    },
    // The ported operational system (docs/PENGGABUNGAN.md). Every Laravel
    // screen is here; new ones join this list when they exist — never as
    // disabled items.
    {
      key: 'operasional',
      label: 'Operasional',
      description: 'Kegiatan kapal & biaya',
      icon: Ship,
      groups: canReadOperational(role)
        ? [
            { items: [{ label: 'Dasbor', icon: LayoutDashboard, href: '/operasional', exact: true }] },
            {
              heading: 'Kegiatan',
              items: [
                { label: 'Database General', icon: Database, href: '/operasional/general' },
                { label: 'Detail Kegiatan Kapal', icon: ClipboardList, href: '/operasional/kegiatan' }
              ]
            },
            {
              heading: 'Keuangan',
              items: [
                { label: 'Pengeluaran', icon: Receipt, href: '/operasional/pengeluaran' },
                { label: 'Pendapatan', icon: Landmark, href: '/operasional/pendapatan' },
                { label: 'Laporan', icon: FileChartColumn, href: '/operasional/laporan' }
              ]
            },
            {
              heading: 'Data Master',
              items: [
                { label: 'Pemilik', icon: UserRound, href: '/operasional/pemilik' },
                { label: 'Kendaraan', icon: Truck, href: '/operasional/kendaraan' },
                { label: 'Kapal', icon: Ship, href: '/operasional/kapal' },
                { label: 'Karyawan', icon: IdCard, href: '/operasional/karyawan' }
              ]
            }
          ]
        : []
    },
    {
      key: 'admin',
      label: 'Administrasi',
      description: 'Entitas, template & pengguna',
      icon: Settings,
      groups: isDirector(role)
        ? [
            {
              items: [
                { label: 'Entitas', icon: Building2, href: '/admin/entities' },
                { label: 'Template', icon: FileSpreadsheet, href: '/admin/templates' },
                { label: 'Pengguna', icon: Users, href: '/admin/users' },
                { label: 'Pemetaan Biaya', icon: Split, href: '/admin/pemetaan-biaya' }
              ]
            }
          ]
        : []
    }
  ]);

  const visibleItems = (m: Module) => m.groups.flatMap((g) => g.items).filter((i) => i.visible !== false);

  /** Modules this role has at least one screen in. */
  const available = $derived(modules.filter((m) => visibleItems(m).length > 0));

  const currentKey = $derived<ModuleKey>(
    page.url.pathname.startsWith('/operasional')
      ? 'operasional'
      : page.url.pathname.startsWith('/admin')
        ? 'admin'
        : 'keuangan'
  );
  const current = $derived(available.find((m) => m.key === currentKey) ?? available[0]);

  function isActive(item: NavItem) {
    const base = item.match ?? item.href;
    if (item.exact) return page.url.pathname === base;
    return page.url.pathname === base || page.url.pathname.startsWith(base + '/');
  }

  // ---- Operasional context: entity and period ride along between screens ---
  //
  // Read from `page.data` because they come from the /operasional layout,
  // which sits below the one rendering this sidebar.

  type OpEntity = { id: string; code: string; legal_name: string };
  const opEntities = $derived((page.data.opEntities ?? []) as OpEntity[]);
  const opEntity = $derived((page.data.opEntity ?? null) as OpEntity | null);
  const opReadOnly = $derived(currentKey === 'operasional' && page.data.canWrite === false);

  /**
   * The chosen entity and month follow the admin from screen to screen, so
   * picking Oktober on Database General and then opening Pengeluaran shows
   * Oktober too. Screen-specific filters (?kapal, ?pemilik) do not. A
   * kegiatan's own screens carry no period in their URL; there the month is
   * the kegiatan's, so leaving one lands back on the month it belongs to.
   */
  const opQuery = $derived.by(() => {
    if (currentKey !== 'operasional') return '';
    const q = new URLSearchParams();
    if (opEntity) q.set('entitas', opEntity.code);
    const kegiatan = page.data.kegiatan as { bulan?: number; tahun?: number } | undefined;
    for (const key of ['bulan', 'tahun'] as const) {
      const value = page.url.searchParams.get(key) ?? kegiatan?.[key];
      if (value) q.set(key, String(value));
    }
    const s = q.toString();
    return s ? `?${s}` : '';
  });

  const hrefFor = (item: NavItem) => (item.href.startsWith('/operasional') ? item.href + opQuery : item.href);

  function chooseEntity(event: Event) {
    const code = (event.currentTarget as HTMLSelectElement).value;
    // One kegiatan belongs to one entity; switching goes back to its list.
    const path = page.url.pathname.replace(/^(\/operasional\/kegiatan)\/\d+.*$/, '$1');
    goto(`${path}?entitas=${encodeURIComponent(code)}`);
  }

  // ---- Module switcher -----------------------------------------------------

  let switcherOpen = $state(false);
  let switcherEl = $state<HTMLDivElement>();
  const canSwitch = $derived(available.length > 1);

  function closeAll() {
    switcherOpen = false;
    onclose?.();
  }

  function onWindowClick(event: MouseEvent) {
    if (switcherOpen && switcherEl && !switcherEl.contains(event.target as Node)) switcherOpen = false;
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && switcherOpen) switcherOpen = false;
  }

  const initials = $derived(
    (fullName ?? '?')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
  );

  /**
   * The collapsed choice outlives the tab. It is a cookie rather than
   * localStorage so the server renders the sidebar at the width the user last
   * chose — read from localStorage after hydration, the rail would visibly
   * jump on every full page load.
   */
  function toggleCollapsed() {
    collapsed = !collapsed;
    switcherOpen = false;
    document.cookie = `sidebar=${collapsed ? 'rail' : 'full'}; path=/; max-age=31536000; samesite=lax`;
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<!-- Backdrop. Mobile only; the desktop sidebar never covers anything. -->
{#if open}
  <button
    type="button"
    class="md:hidden fixed inset-0 z-40 bg-black/60"
    aria-label="Tutup menu"
    onclick={() => onclose?.()}
  ></button>
{/if}

<!--
  `invisible` when the drawer is shut, not just translated off-screen: a
  sidebar parked at -100% is still in the tab order, so tabbing through a
  phone screen walks into links nobody can see. `visibility` also takes the
  responsive variant, which `inert` cannot — `inert` is an attribute, and on
  desktop `open` is always false, so an inert bound to it would disable the
  sidebar for every desktop user.
-->
<aside
  class="fixed inset-y-0 left-0 z-50 w-[272px] shrink-0 flex flex-col h-screen
         border-r border-border bg-background transition-[transform,width] duration-200
         md:relative md:z-30 md:translate-x-0 md:visible
         {open ? 'translate-x-0 visible' : '-translate-x-full invisible'}
         {collapsed ? 'md:w-[64px]' : 'md:w-[256px]'}"
>
  <!-- Module switcher: the logo and the module name are one button. -->
  <div
    bind:this={switcherEl}
    class="relative h-12 flex items-center gap-1 border-b border-border shrink-0
           {collapsed ? 'md:justify-center md:px-0 px-2' : 'px-2'}"
  >
    <button
      type="button"
      onclick={() => canSwitch && (switcherOpen = !switcherOpen)}
      aria-haspopup={canSwitch ? 'menu' : undefined}
      aria-expanded={canSwitch ? switcherOpen : undefined}
      title={canSwitch ? 'Ganti modul' : undefined}
      class="min-w-0 flex-1 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors
             {collapsed ? 'md:flex-none md:justify-center md:px-1.5' : ''}
             {canSwitch ? 'hover:bg-card cursor-pointer' : 'cursor-default'}
             {switcherOpen ? 'bg-card' : ''}"
    >
      <div class="w-7 h-7 rounded-md bg-primary flex items-center justify-center shrink-0">
        {#if current}
          <current.icon size={17} class="text-primary-foreground" />
        {:else}
          <ChartColumn size={17} class="text-primary-foreground" />
        {/if}
      </div>
      <div class="min-w-0 flex-1 {collapsed ? 'md:hidden' : ''}">
        <p class="text-[13px] text-muted-foreground leading-tight truncate">IMR Platform</p>
        <p class="text-[16px] font-semibold text-foreground leading-tight truncate">
          {current?.label ?? 'IMR Platform'}
        </p>
      </div>
      {#if canSwitch}
        <ChevronsUpDown size={17} class="shrink-0 text-muted-foreground {collapsed ? 'md:hidden' : ''}" />
      {/if}
    </button>

    <!-- Mobile: close. Desktop: nothing — the rail toggle lives at the foot. -->
    <button
      type="button"
      class="md:hidden text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0"
      aria-label="Tutup menu"
      onclick={() => onclose?.()}
    >
      <X size={18} />
    </button>

    {#if switcherOpen}
      <div
        role="menu"
        class="absolute z-50 w-[248px] p-1 rounded-lg border border-border bg-popover shadow-lg
               top-[calc(100%-4px)] left-2
               {collapsed ? 'md:top-1.5 md:left-[calc(100%+6px)]' : ''}"
      >
        <p class="px-2.5 pt-1.5 pb-1 text-[13px] font-medium uppercase tracking-wide text-subtle">Modul</p>
        {#each available as m (m.key)}
          {@const first = visibleItems(m)[0]}
          <a
            role="menuitem"
            href={first.href}
            onclick={closeAll}
            aria-current={m.key === current?.key ? 'page' : undefined}
            class="flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors
                   {m.key === current?.key ? 'bg-primary/10' : 'hover:bg-card'}"
          >
            <div
              class="w-7 h-7 rounded-md flex items-center justify-center shrink-0
                     {m.key === current?.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}"
            >
              <m.icon size={17} />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-[16px] font-medium truncate {m.key === current?.key ? 'text-primary' : 'text-foreground'}">
                {m.label}
              </p>
              <p class="text-[14px] text-muted-foreground truncate">{m.description}</p>
            </div>
            {#if m.key === current?.key}<Check size={17} class="shrink-0 text-primary" />{/if}
          </a>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Operasional context: which entity, and whether this role may write. -->
  {#if currentKey === 'operasional' && opEntity}
    <div class="px-3 pt-3 pb-1 shrink-0 {collapsed ? 'md:px-2' : ''}">
      {#if opEntities.length > 1}
        <label
          for="op-entity"
          class="block text-[13px] font-medium uppercase tracking-wide text-subtle mb-1 {collapsed ? 'md:sr-only' : ''}"
        >
          Entitas
        </label>
        <select
          id="op-entity"
          value={opEntity.code}
          onchange={chooseEntity}
          title={opEntity.legal_name}
          class="w-full h-10 px-2 bg-background border border-border rounded-md text-[15px] text-foreground
                 focus:outline-none focus:border-primary {collapsed ? 'md:px-0.5 md:text-[14px]' : ''}"
        >
          {#each opEntities as entity (entity.id)}
            <option value={entity.code}>{entity.code}</option>
          {/each}
        </select>
      {:else}
        <div
          class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-card border border-border {collapsed ? 'md:justify-center md:px-0' : ''}"
          title={opEntity.legal_name}
        >
          <Building2 size={16} class="shrink-0 text-muted-foreground" />
          <span class="text-[15px] font-medium text-foreground shrink-0">{opEntity.code}</span>
          <span class="text-[14px] text-muted-foreground truncate {collapsed ? 'md:hidden' : ''}">
            {opEntity.legal_name}
          </span>
        </div>
      {/if}
      {#if opReadOnly}
        <p
          class="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted text-[14px] text-muted-foreground
                 {collapsed ? 'md:justify-center md:px-0' : ''}"
          title="Peran Anda membaca data operasional tanpa mengubahnya."
        >
          <Eye size={15} class="shrink-0" />
          <span class={collapsed ? 'md:hidden' : ''}>Mode baca</span>
        </p>
      {/if}
    </div>
  {/if}

  <nav class="flex-1 p-2 overflow-y-auto" aria-label={current ? `Menu ${current.label}` : 'Menu'}>
    {#each current?.groups ?? [] as group, g (group.heading ?? g)}
      {@const items = group.items.filter((i) => i.visible !== false)}
      {#if items.length}
        {#if group.heading}
          <p
            class="px-3 pt-3 pb-1 text-[13px] font-medium uppercase tracking-wide text-subtle truncate
                   {collapsed ? 'md:hidden' : ''}"
          >
            {group.heading}
          </p>
          {#if collapsed}<div class="hidden md:block mx-2 my-2 border-t border-border"></div>{/if}
        {/if}
        <div class="space-y-px">
          {#each items as item (item.href)}
            {@const active = isActive(item)}
            <a
              href={hrefFor(item)}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              onclick={() => onclose?.()}
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-[16px] font-medium transition-colors
                     {collapsed ? 'md:justify-center md:px-0' : ''}
                     {active
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:bg-card hover:text-foreground'}"
            >
              <item.icon size={18} class="shrink-0" />
              <span class="truncate {collapsed ? 'md:hidden' : ''}">{item.label}</span>
            </a>
          {/each}
        </div>
      {/if}
    {/each}
  </nav>

  <!-- Sits with the rail toggle rather than in the nav: neither is a place to
       go, they are both controls on the shell itself. -->
  <div class="px-2 pb-1 shrink-0">
    <ThemeToggle {theme} {collapsed} />
  </div>

  <!-- Rail toggle. Desktop only: on a phone the sidebar is a drawer, and a
       drawer that collapses into icons is two controls doing one job. -->
  <div class="hidden md:block px-2 pb-1 shrink-0">
    <button
      type="button"
      onclick={toggleCollapsed}
      aria-expanded={!collapsed}
      title={collapsed ? 'Lebarkan menu' : 'Ciutkan menu'}
      class="w-full flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[16px]
             text-muted-foreground hover:bg-card hover:text-foreground transition-colors
             {collapsed ? 'justify-center px-0' : ''}"
    >
      {#if collapsed}
        <ChevronRight size={17} class="shrink-0" />
      {:else}
        <ChevronLeft size={17} class="shrink-0" />
        <span class="truncate">Ciutkan menu</span>
      {/if}
    </button>
  </div>

  <div class="border-t border-border shrink-0 {collapsed ? 'md:px-2 px-4 py-3' : 'px-4 py-3'}">
    <div class="flex items-center gap-2 {collapsed ? 'md:justify-center' : ''}">
      <div
        class="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-[14px]
               font-semibold text-foreground shrink-0"
        title={collapsed ? `${fullName ?? 'Tanpa nama'} · ${role ? ROLE_LABEL[role] : 'Tanpa peran'}` : undefined}
      >
        {initials}
      </div>
      <div class="min-w-0 flex-1 {collapsed ? 'md:hidden' : ''}">
        <p class="text-[15px] font-medium text-foreground truncate">{fullName ?? 'Tanpa nama'}</p>
        <p class="text-[14px] text-muted-foreground truncate">
          {role ? ROLE_LABEL[role] : 'Tanpa peran'}
        </p>
      </div>
      <form method="POST" action="/logout" class={collapsed ? 'md:hidden' : ''}>
        <!-- Labelled: a bare door-arrow icon is not one people recognise. -->
        <button
          type="submit"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border
                 text-[14px] font-medium text-foreground hover:bg-card transition-colors"
          title="Keluar dari aplikasi"
        >
          <LogOut size={16} />
          Keluar
        </button>
      </form>
    </div>
  </div>
</aside>
