<script lang="ts">
  /**
   * Month and year for the kegiatan screens. Changes the URL, keeping every
   * other parameter (entitas, a kapal filter), so a period is bookmarkable and
   * survives a reload.
   */
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { NAMA_BULAN, type Periode } from './kegiatan';

  let { bulan, tahun }: Periode = $props();

  const SELECT =
    'h-[30px] px-2 bg-background border border-border rounded-md text-[12px] text-foreground ' +
    'focus:outline-none focus:border-primary';

  const tahunPilihan = $derived.by(() => {
    const now = new Date().getFullYear();
    const from = Math.min(tahun, now - 3);
    const to = Math.max(tahun, now + 1);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });

  function pergi(next: Periode) {
    const url = new URL(page.url);
    url.searchParams.set('bulan', String(next.bulan));
    url.searchParams.set('tahun', String(next.tahun));
    goto(url, { keepFocus: true, noScroll: true });
  }

  function geser(langkah: number) {
    const index = tahun * 12 + (bulan - 1) + langkah;
    pergi({ bulan: (index % 12) + 1, tahun: Math.floor(index / 12) });
  }
</script>

<div class="flex items-center gap-1">
  <button
    type="button"
    onclick={() => geser(-1)}
    class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
    aria-label="Bulan sebelumnya"
  >
    <ChevronLeft size={14} />
  </button>
  <label class="sr-only" for="periode-bulan">Bulan</label>
  <select
    id="periode-bulan"
    value={bulan}
    onchange={(e) => pergi({ bulan: Number(e.currentTarget.value), tahun })}
    class={SELECT}
  >
    {#each NAMA_BULAN as nama, i (nama)}
      <option value={i + 1}>{nama}</option>
    {/each}
  </select>
  <label class="sr-only" for="periode-tahun">Tahun</label>
  <select
    id="periode-tahun"
    value={tahun}
    onchange={(e) => pergi({ bulan, tahun: Number(e.currentTarget.value) })}
    class={SELECT}
  >
    {#each tahunPilihan as t (t)}
      <option value={t}>{t}</option>
    {/each}
  </select>
  <button
    type="button"
    onclick={() => geser(1)}
    class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
    aria-label="Bulan berikutnya"
  >
    <ChevronRight size={14} />
  </button>
</div>
