<script lang="ts">
  import { NAMA_BULAN } from '$lib/operasional/kegiatan';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const n = (v: number, d = 0) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const bulan = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`);
</script>

<svelte:head><title>Rekapitulasi Biaya Kendaraan {data.pemilik.nama} {bulan}</title></svelte:head>

<div class="cetak">
  <button type="button" class="tombol" onclick={() => window.print()}>Cetak / Simpan PDF</button>
  <h1>Rekapitulasi Biaya Kendaraan</h1>
  <h2>{data.entity.legal_name.toUpperCase()}</h2>
  <p class="sub">Pemilik / Rekanan: <b>{data.pemilik.nama}</b> · Periode {bulan}</p>
  <table>
    <thead>
      <tr>
        <th>No</th><th>Nopol</th><th>Kapal</th><th>Rute</th><th>Ritase</th><th>Tonnase (MT)</th><th>Ongkos Angkut (Rp)</th>
        <th>Pendapatan Bruto (Rp)</th><th>Saku Supir (Rp)</th><th>Uang Terpal (Rp)</th><th>Jumlah Bersih (Rp)</th>
      </tr>
    </thead>
    <tbody>
      {#each data.rincian as r, i (i)}
        <tr>
          <td class="c">{i + 1}</td><td class="b">{r.nopol}</td><td>{r.kapal}</td><td>{r.rute}</td>
          <td class="r">{r.ritase}</td><td class="r">{n(r.tonase, 2)}</td><td class="r">{n(r.ongkos_angkut)}</td>
          <td class="r">{n(r.pendapatan)}</td><td class="r">{n(r.sangu_supir)}</td><td class="r">{n(r.terpal)}</td><td class="r b">{n(r.bersih)}</td>
        </tr>
      {:else}
        <tr><td colspan="11" class="c">Tidak ada transaksi pada periode ini.</td></tr>
      {/each}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4" class="c">TOTAL</td><td class="r">{data.jumlah.ritase}</td><td class="r">{n(data.jumlah.tonase, 2)}</td><td></td>
        <td class="r">{n(data.jumlah.pendapatan)}</td><td class="r">{n(data.jumlah.sangu_supir)}</td><td class="r">{n(data.jumlah.terpal)}</td><td class="r">{n(data.jumlah.bersih)}</td>
      </tr>
    </tfoot>
  </table>
</div>

<style>
  /* Paper, not screen — black on white whatever the app theme is. */
  @page { size: A4 landscape; margin: 10mm; }
  :global(html), :global(body) { background: white !important; color: black !important; }
  .cetak { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: black; background: white; padding: 14px; }
  h1 { text-align: center; font-size: 14px; margin: 0; text-transform: uppercase; }
  h2 { text-align: center; font-size: 12px; margin: 2px 0; }
  .sub { text-align: center; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid black; padding: 4px 5px; white-space: nowrap; }
  th { background: #eee; font-size: 9px; }
  tfoot td { font-weight: 900; }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: bold; }
  .tombol { position: fixed; top: 12px; right: 12px; padding: 8px 14px; border: 1px solid black; border-radius: 6px; background: white; font-weight: bold; cursor: pointer; }
  @media print { .tombol { display: none; } .cetak { padding: 0; } }
</style>
