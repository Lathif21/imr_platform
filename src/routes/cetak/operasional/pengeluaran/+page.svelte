<script lang="ts">
  import { onMount } from 'svelte';
  import { NAMA_BULAN } from '$lib/operasional/kegiatan';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const rp = (v: number) => 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(v);
  const tgl = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  const hariIni = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

  // Laravel opened the print dialog as soon as this page loaded.
  onMount(() => window.print());
</script>

<svelte:head><title>Rekapan Pengeluaran {NAMA_BULAN[data.periode.bulan - 1]} {data.periode.tahun}</title></svelte:head>

<div class="cetak">
  <div class="tombol-grup">
    <button type="button" onclick={() => window.print()}>Cetak / Simpan PDF</button>
    <button type="button" onclick={() => window.close()}>Tutup</button>
  </div>
  <h1>Rekapan Pengeluaran Bulan {NAMA_BULAN[data.periode.bulan - 1]} {data.periode.tahun}</h1>
  <table>
    <thead>
      <tr><th class="c" style="width:5%">No</th><th style="width:15%">Tanggal</th><th style="width:15%">Jenis</th><th style="width:20%">Nama Pengeluaran</th><th style="width:20%">Penerima</th><th class="r" style="width:25%">Jumlah</th></tr>
    </thead>
    <tbody>
      {#each data.baris as r, i (r.id)}
        <tr>
          <td class="c">{i + 1}</td>
          <td>{tgl(r.tanggal)}</td>
          <td>{r.jenis}</td>
          <td>{r.nama_kegiatan || '-'}{#if r.keterangan}<br /><small>({r.keterangan})</small>{/if}</td>
          <td>{r.penerima || '-'}</td>
          <td class="r">{rp(r.jumlah)}</td>
        </tr>
      {:else}
        <tr><td colspan="6" class="c">Tidak ada data pengeluaran untuk bulan ini.</td></tr>
      {/each}
    </tbody>
    {#if data.baris.length}
      <tfoot><tr><th colspan="5" class="r">TOTAL KESELURUHAN</th><th class="r">{rp(data.total)}</th></tr></tfoot>
    {/if}
  </table>
  <div class="ttd">
    <p>Surabaya, {hariIni}</p>
    <p>Mengetahui,</p>
    <p>Kepala Departemen</p>
    <p class="nama">( ......................................... )</p>
  </div>
</div>

<style>
  /* Paper, not screen — black on white whatever the app theme is. */
  @page { size: A4 portrait; margin: 12mm; }
  :global(html), :global(body) { background: white !important; color: black !important; }
  .cetak { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: black; background: white; padding: 20px; }
  h1 { text-align: center; font-size: 16px; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid black; padding: 6px 8px; text-align: left; }
  th { background: #f2f2f2; }
  small { color: #666; }
  .c { text-align: center; }
  .r { text-align: right; }
  .ttd { width: 260px; margin: 30px 0 0 auto; text-align: center; }
  .ttd p { margin: 2px 0; }
  .nama { margin-top: 70px !important; }
  .tombol-grup { display: flex; gap: 8px; margin-bottom: 16px; }
  .tombol-grup button { padding: 8px 14px; border: 1px solid black; border-radius: 6px; background: white; font-weight: bold; cursor: pointer; }
  @media print { .tombol-grup { display: none; } .cetak { padding: 0; } }
</style>
