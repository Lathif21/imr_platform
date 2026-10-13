<script lang="ts">
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const l = $derived(data.laporan);

  /** Negative amounts in parentheses, as everywhere in this app. */
  const rp = (v: number) => {
    const s = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.abs(v));
    return v < 0 ? `(${s})` : s;
  };
  const hariIni = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

  onMount(() => window.print());
</script>

<svelte:head><title>Laporan Laba Rugi {l.entitas.code} {l.judulPeriode}</title></svelte:head>

<div class="cetak">
  <div class="tombol-grup">
    <button type="button" onclick={() => window.print()}>Cetak / Simpan PDF</button>
    <button type="button" onclick={() => window.close()}>Tutup</button>
  </div>

  <h1>LAPORAN LABA RUGI</h1>
  <h2>{l.entitas.legal_name}</h2>
  <p class="sub">Periode {l.judulPeriode} · {l.statusLabel} · {l.basisLabel}</p>

  <table>
    <thead>
      <tr><th>Pos</th><th class="r" style="width:30%">Jumlah (Rp)</th></tr>
    </thead>
    <tbody>
      {#each l.baris as b, i (i)}
        {#if b.jenis === 'pos'}
          <tr>
            <td class="pos">{b.label}{#if b.catatan}<br /><small>{b.catatan}</small>{/if}</td>
            <td class="r">{rp(b.jumlah)}</td>
          </tr>
        {:else}
          <tr class={b.jenis}>
            <td>{b.label}</td>
            <td class="r">{rp(b.jumlah)}</td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>

  <p class="kaki">Dicetak dari IMR Platform, {hariIni}. Laporan ini berstatus {l.statusLabel.toLowerCase()}.</p>
</div>

<style>
  /* Paper, not screen — black on white whatever the app theme is. */
  @page { size: A4 portrait; margin: 14mm; }
  :global(html), :global(body) { background: white !important; color: black !important; }
  .cetak { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: black; background: white; padding: 20px; max-width: 720px; margin: 0 auto; }
  h1 { text-align: center; font-size: 16px; margin: 0; }
  h2 { text-align: center; font-size: 14px; margin: 4px 0 0; }
  .sub { text-align: center; margin: 4px 0 16px; color: #333; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid black; padding: 6px 8px; text-align: left; }
  th { background: #f2f2f2; }
  .r { text-align: right; font-variant-numeric: tabular-nums; }
  .pos { padding-left: 22px; }
  small { color: #555; }
  .bagian td { font-weight: bold; background: #fafafa; }
  .subtotal td { font-weight: bold; background: #ececec; }
  .kaki { margin-top: 18px; font-size: 10px; color: #555; }
  .tombol-grup { display: flex; gap: 8px; margin-bottom: 16px; }
  .tombol-grup button { padding: 8px 14px; border: 1px solid black; border-radius: 6px; background: white; font-weight: bold; cursor: pointer; }
  @media print { .tombol-grup { display: none; } .cetak { padding: 0; } }
</style>
