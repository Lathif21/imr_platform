<script lang="ts">
  /**
   * Six months of laba bersih for one entity, as thin columns from a zero
   * baseline: a loss hangs below the line, so the sign reads by position and
   * never by colour alone. The month on screen is in the accent, the rest in
   * the muted ink. One series, so no legend; the hover tooltip and the
   * aria-label carry every value.
   */
  import { formatCompact } from '$lib/format';
  import { NAMA_BULAN, type Periode } from '$lib/operasional/kegiatan';

  let { titik }: { titik: { periode: Periode; laba: number }[] } = $props();

  const W = 104;
  const H = 34;
  const BAR = 10;
  const slot = $derived(W / Math.max(titik.length, 1));

  const nilai = $derived(titik.map((t) => t.laba));
  const max = $derived(Math.max(0, ...nilai));
  const min = $derived(Math.min(0, ...nilai));
  const span = $derived(max - min || 1);
  /** y of the zero line: losses take the room below it. */
  const nol = $derived(1 + ((max - 0) / span) * (H - 2));

  const label = (p: Periode) => `${NAMA_BULAN[p.bulan - 1].slice(0, 3)} ${p.tahun}`;

  /** Column path with a rounded data-end and a square end on the baseline. */
  function kolom(i: number, v: number): string {
    const x = i * slot + (slot - BAR) / 2;
    const h = Math.max((Math.abs(v) / span) * (H - 2), v === 0 ? 0 : 1.5);
    const r = Math.min(2, h, BAR / 2);
    if (v >= 0) {
      const y = nol - h;
      return `M${x},${nol}V${y + r}Q${x},${y} ${x + r},${y}H${x + BAR - r}Q${x + BAR},${y} ${x + BAR},${y + r}V${nol}Z`;
    }
    const y = nol + h;
    return `M${x},${nol}V${y - r}Q${x},${y} ${x + r},${y}H${x + BAR - r}Q${x + BAR},${y} ${x + BAR},${y - r}V${nol}Z`;
  }

  let aktif = $state<number | null>(null);
</script>

<div class="relative inline-block" role="img"
  aria-label={'Laba bersih 6 bulan: ' + titik.map((t) => `${label(t.periode)} ${formatCompact(t.laba)}`).join(', ')}>
  <svg width={W} height={H} viewBox="0 0 {W} {H}" class="block overflow-visible">
    <line x1="0" x2={W} y1={nol} y2={nol} class="stroke-border" stroke-width="1" />
    {#each titik as t, i (i)}
      <path
        d={kolom(i, t.laba)}
        class={i === titik.length - 1 ? 'fill-primary' : 'fill-muted-foreground'}
        opacity={i === titik.length - 1 ? 1 : aktif === i ? 0.85 : 0.45}
      />
      <!-- Hit target wider and taller than the mark. -->
      <rect
        x={i * slot}
        y="0"
        width={slot}
        height={H}
        fill="transparent"
        onmouseenter={() => (aktif = i)}
        onmouseleave={() => (aktif = null)}
        role="presentation"
      />
    {/each}
  </svg>
  {#if aktif !== null}
    {@const t = titik[aktif]}
    <div
      class="absolute bottom-full mb-1 z-10 whitespace-nowrap rounded-md border border-border bg-popover
             px-2 py-1 text-[11px] text-foreground shadow-sm pointer-events-none"
      style="left: {Math.min(aktif * slot, W - 70)}px"
    >
      <span class="text-muted-foreground">{label(t.periode)}</span>
      <span class="num font-medium ml-1">{formatCompact(t.laba)}</span>
    </div>
  {/if}
</div>
