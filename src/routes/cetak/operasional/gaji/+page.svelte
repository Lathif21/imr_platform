<script lang="ts">
  import { NAMA_BULAN } from '$lib/operasional/kegiatan';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const n = (v: number, d = 0, maks = d) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: maks }).format(v);
  const bulan = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`);
  const jumlah = $derived(
    data.ringkas.reduce((a, r) => ({ kotor: a.kotor + r.gaji_kotor, pph: a.pph + r.pph, bersih: a.bersih + r.gaji_bersih }), { kotor: 0, pph: 0, bersih: 0 })
  );
</script>

<svelte:head><title>Slip Gaji {data.karyawan?.nama ?? 'Karyawan'} {bulan}</title></svelte:head>

<div class="cetak">
  <button type="button" class="tombol" onclick={() => window.print()}>Cetak / Simpan PDF</button>
  <h1>{data.karyawan?.admin ? 'Slip Gaji Karyawan' : 'Slip Gaji Karyawan Telly'}</h1>
  <h2>{data.entity.legal_name.toUpperCase()}</h2>
  <p class="periode">Periode {bulan}</p>

  {#if data.karyawan}
    <table class="identitas">
      <tbody>
        <tr><td>Nama</td><td>: <b>{data.karyawan.nama}</b></td><td>KTP</td><td>: {data.karyawan.ktp ?? '-'}</td></tr>
        <tr><td>Jabatan</td><td>: {data.karyawan.jabatan ?? '-'}</td><td>NPWP</td><td>: {data.karyawan.npwp ?? '-'}</td></tr>
      </tbody>
    </table>
  {/if}

  <table>
    <thead>
      <tr><th>No</th><th>Nama Karyawan &amp; Jabatan</th><th>Total Gaji Kotor (Rp)</th><th>Pot. PPh (Rp)</th><th>Net Gaji Bersih (Rp)</th></tr>
    </thead>
    <tbody>
      {#each data.ringkas as r, i (r.id)}
        <tr>
          <td class="c">{i + 1}</td>
          <td><b>{r.nama}</b>{r.jabatan ? ` — ${r.jabatan}` : ''}</td>
          <td class="r">{n(r.gaji_kotor)}</td>
          <td class="r">{n(r.pph)}</td>
          <td class="r b">{n(r.gaji_bersih)}</td>
        </tr>
      {:else}
        <tr><td colspan="5" class="c">Tidak ada gaji tercatat untuk periode ini.</td></tr>
      {/each}
    </tbody>
    {#if data.ringkas.length > 1}
      <tfoot><tr><td colspan="2" class="b">TOTAL</td><td class="r b">{n(jumlah.kotor)}</td><td class="r b">{n(jumlah.pph)}</td><td class="r b">{n(jumlah.bersih)}</td></tr></tfoot>
    {/if}
  </table>

  {#if data.honor.length}
    <table>
      <thead>
        <tr><th>KEGIATAN</th><th>RUTE</th><th>TONASE (MT)</th><th>GAJI</th><th>GAJI TOTAL</th><th>KETERANGAN</th></tr>
      </thead>
      <tbody>
        {#each data.honor as h (h.id)}
          <tr>
            <td class="b">{h.kegiatan}</td>
            <td>{h.rute ?? '-'}</td>
            <td class="r">{n(h.tonase, 2, 3)}</td>
            <td class="r">{n(h.gaji)}</td>
            <td class="r">{n(h.gaji_total)}</td>
            <td>{h.keterangan ?? ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else if data.admin}
    <p class="ket">Keterangan: {data.admin.keterangan ?? 'Gaji Admin Bulanan'}</p>
  {/if}

  <div class="ttd">
    <div><p>Diterima oleh,</p><p class="nama">( {data.karyawan?.nama ?? '____________________'} )</p></div>
    <div><p>Disetujui oleh,</p><p class="nama">( ____________________ )</p></div>
  </div>
</div>

<style>
  /* Paper, not screen — black on white whatever the app theme is. */
  @page { size: A4 portrait; margin: 12mm; }
  :global(html), :global(body) { background: white !important; color: black !important; }
  .cetak { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: black; background: white; padding: 20px; max-width: 800px; margin: 0 auto; }
  h1 { text-align: center; font-size: 15px; margin: 0; text-transform: uppercase; }
  h2 { text-align: center; font-size: 12px; margin: 2px 0; }
  .periode { text-align: center; margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  th, td { border: 1px solid black; padding: 5px 6px; }
  th { background: #eee; font-size: 10px; }
  .identitas td { border: none; padding: 2px 4px; }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: bold; }
  .ket { font-style: italic; }
  .ttd { display: grid; grid-template-columns: 1fr 1fr; text-align: center; margin-top: 30px; }
  .nama { margin-top: 60px; font-weight: bold; }
  .tombol { position: fixed; top: 12px; right: 12px; padding: 8px 14px; border: 1px solid black; border-radius: 6px; background: white; font-weight: bold; cursor: pointer; }
  @media print { .tombol { display: none; } .cetak { padding: 0; } }
</style>
