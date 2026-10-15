<script lang="ts">
  /**
   * Ringkasan Eksekutif. One row per entity the caller may read; what is wrong
   * is listed above the table so nobody has to scan for it. Every figure comes
   * from the admins' operational input — see $lib/server/ringkasan-operasional
   * for what laba bersih is, and why it matches the Dasbor Operasional.
   */
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import OctagonAlert from 'lucide-svelte/icons/octagon-alert';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import TrenLaba from '$lib/components/TrenLaba.svelte';
  import { formatCompact, formatDelta, formatPct, momPct } from '$lib/format';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, ton } from '$lib/operasional/kegiatan';
  import {
    PIUTANG_LAMA_HARI,
    geserBulan,
    jumlahkan,
    kosong,
    margin,
    rasioRekanan,
    type AngkaBulan
  } from '$lib/operasional/ringkasan';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const namaBulan = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`);
  const lalu = $derived(NAMA_BULAN[geserBulan(data.periode, -1).bulan - 1].slice(0, 3));
  const jumlah = $derived(jumlahkan(data.rows.map((r) => r.ini)));
  const jumlahLalu = $derived(jumlahkan(data.rows.map((r) => r.lalu)));
  const belumInput = $derived(data.rows.filter((r) => kosong(r.ini)).map((r) => r.code));
  const piutangTotal = $derived(data.rows.reduce((s, r) => s + r.piutang.nilai, 0));

  const href = (code: string) =>
    `/operasional?entitas=${encodeURIComponent(code)}&bulan=${data.periode.bulan}&tahun=${data.periode.tahun}`;

  /** "▲ 12,4% vs Sep", muted: up is good for revenue and bad for costs. */
  function delta(ini: number, sebelum: number): string {
    const p = momPct(ini, sebelum);
    return p === null ? '' : `${p >= 0 ? '▲' : '▼'} ${formatDelta(p).replace(/^[+−]/, '')} vs ${lalu}`;
  }

  const KARTU = 'bg-card border border-border rounded-lg';
  const TH = 'px-3 py-2 text-[12px] font-medium text-muted-foreground text-right whitespace-nowrap';
  const TD = 'px-3 py-2.5 text-right align-top whitespace-nowrap';
</script>

<svelte:head><title>Ringkasan Eksekutif · IMR Platform</title></svelte:head>

{#snippet sel(ini: number, sebelum: number, warna = 'text-foreground')}
  <div class="num text-[13px] {warna}">{formatCompact(ini)}</div>
  <div class="text-[11px] text-muted-foreground num">{delta(ini, sebelum)}</div>
{/snippet}

{#snippet laba(a: AngkaBulan)}
  <div class="num text-[13px] font-semibold {a.laba < 0 ? 'text-destructive' : 'text-positive'}">
    {formatCompact(a.laba)}
  </div>
  <div class="text-[11px] text-muted-foreground num">
    {margin(a) === null ? '—' : `margin ${formatPct(margin(a))}`}
  </div>
{/snippet}

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-[17px] font-semibold text-foreground">Ringkasan Eksekutif</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">
        {namaBulan} · {data.rows.length} entitas · dari input operasional
      </p>
    </div>
    <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
  </div>

  {#if data.rows.length === 0}
    <div class="{KARTU} p-5 max-w-[560px]">
      <h2 class="text-[14px] font-semibold text-foreground">Belum ada entitas</h2>
      <p class="text-[13px] text-muted-foreground mt-1 leading-relaxed">
        Akun Anda belum ditautkan ke entitas mana pun. Minta direksi menautkannya di Admin → Pengguna.
      </p>
    </div>
  {:else}
    {#if data.peringatan.length > 0}
      <section class="{KARTU} p-4" aria-labelledby="perhatian">
        <h2 id="perhatian" class="text-[14px] font-semibold text-foreground mb-2">Perlu perhatian</h2>
        <ul class="space-y-1.5">
          {#each data.peringatan as p, i (i)}
            <li class="flex items-start gap-2 text-[13px]">
              {#if p.tingkat === 'kritis'}
                <OctagonAlert size={14} class="text-destructive shrink-0 mt-0.5" />
                <span class="text-destructive font-medium shrink-0">Kritis</span>
              {:else}
                <TriangleAlert size={14} class="text-warning shrink-0 mt-0.5" />
                <span class="text-warning font-medium shrink-0">Perhatian</span>
              {/if}
              <a href={href(p.code)} class="font-semibold text-foreground hover:underline shrink-0">{p.code}</a>
              <span class="text-muted-foreground">{p.teks}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="{KARTU} overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-[13px] min-w-[880px]">
          <thead class="border-b border-border">
            <tr>
              <th class="{TH} text-left">Entitas</th>
              <th class={TH}>Pendapatan</th>
              <th class={TH}>Pengeluaran</th>
              <th class={TH}>Laba bersih</th>
              <th class={TH}>Piutang</th>
              <th class={TH} title="Beban rekanan dibagi pendapatan">Rekanan</th>
              <th class={TH}>Volume</th>
              <th class="{TH} text-left">6 bulan</th>
            </tr>
          </thead>
          <tbody>
            {#each data.rows as r (r.code)}
              <tr class="border-b border-border last:border-b-0 hover:bg-muted/40">
                <td class="px-3 py-2.5 align-top">
                  <a href={href(r.code)} class="group inline-flex items-center gap-1 font-semibold text-foreground">
                    {r.code}
                    <ArrowRight size={12} class="text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </a>
                  <div class="text-[11px] text-muted-foreground truncate max-w-[180px]" title={r.nama}>{r.nama}</div>
                </td>
                {#if kosong(r.ini)}
                  <td colspan="3" class="px-3 py-2.5 text-right text-[12px] text-muted-foreground align-top">
                    Belum ada input bulan ini
                  </td>
                {:else}
                  <td class={TD}>{@render sel(r.ini.pendapatan, r.lalu.pendapatan)}</td>
                  <td class={TD}>{@render sel(r.ini.pengeluaran, r.lalu.pengeluaran)}</td>
                  <td class={TD}>{@render laba(r.ini)}</td>
                {/if}
                <td class={TD}>
                  {#if r.piutang.jumlah === 0}
                    <span class="text-muted-foreground">—</span>
                  {:else}
                    <div class="num {r.piutang.lama.jumlah > 0 ? 'text-warning' : 'text-foreground'}">
                      {formatCompact(r.piutang.nilai)}
                    </div>
                    <div class="text-[11px] text-muted-foreground">
                      {r.piutang.jumlah} invoice · tertua {r.piutang.tertuaHari} hr
                    </div>
                  {/if}
                </td>
                <td class="{TD} num">
                  {rasioRekanan(r.ini) === null ? '—' : formatPct(rasioRekanan(r.ini), 0)}
                </td>
                <td class={TD}>
                  <div class="num">{ton(r.ini.tonase)} MT</div>
                  <div class="text-[11px] text-muted-foreground">{r.ini.kegiatan} kegiatan</div>
                </td>
                <td class="px-3 py-2 align-middle">
                  {#await data.tren}
                    <div class="h-[34px] w-[104px] rounded bg-muted/50 animate-pulse" aria-label="Memuat tren"></div>
                  {:then tren}
                    {#if tren[r.code]}<TrenLaba titik={tren[r.code]} />{/if}
                  {:catch}
                    <span class="text-[11px] text-muted-foreground">Tren gagal dimuat</span>
                  {/await}
                </td>
              </tr>
            {/each}
          </tbody>
          {#if data.rows.length > 1}
            <tfoot class="border-t border-border-strong bg-muted/30">
              <tr>
                <td class="px-3 py-2.5 align-top">
                  <div class="font-semibold text-foreground">Jumlah</div>
                  <div class="text-[11px] text-muted-foreground">bukan konsolidasi</div>
                </td>
                <td class={TD}>{@render sel(jumlah.pendapatan, jumlahLalu.pendapatan)}</td>
                <td class={TD}>{@render sel(jumlah.pengeluaran, jumlahLalu.pengeluaran)}</td>
                <td class={TD}>{@render laba(jumlah)}</td>
                <td class="{TD} num">{piutangTotal > 0 ? formatCompact(piutangTotal) : '—'}</td>
                <td class="{TD} num">{rasioRekanan(jumlah) === null ? '—' : formatPct(rasioRekanan(jumlah), 0)}</td>
                <td class={TD}><div class="num">{ton(jumlah.tonase)} MT</div></td>
                <td></td>
              </tr>
            </tfoot>
          {/if}
        </table>
      </div>
    </section>

    <div class="text-[12px] text-muted-foreground leading-relaxed space-y-1 max-w-[860px]">
      <p>
        <span class="text-foreground font-medium">Laba bersih</span> = tagihan bruto − pajak − pengeluaran kotor, dari
        semua invoice {namaBulan} (sudah dibayar atau belum), sebelum bagi hasil 65/35. Pajak mengikuti tarif yang diisi
        admin pada setiap invoice. Angka yang sama tampil di Dasbor Operasional tiap entitas.
      </p>
      <p>
        <span class="text-foreground font-medium">Piutang</span> = net tagihan yang belum dibayar per hari ini, dari
        bulan mana pun; berwarna bila ada yang lebih dari {PIUTANG_LAMA_HARI} hari.
        {#if data.rows.length > 1}
          <span class="text-foreground font-medium">Jumlah</span> adalah penjumlahan biasa, bukan konsolidasi{belumInput.length
            ? ` — ${belumInput.join(', ')} belum ada input bulan ini`
            : ''}.
        {/if}
      </p>
    </div>
  {/if}
</div>
