<script lang="ts">
  import { NAMA_BULAN } from '$lib/operasional/kegiatan';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const n = (v: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(v);
  /** "05-Okt-26", the operational spreadsheet's date format. */
  const tgl = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-');
  };
  const bulan = $derived(NAMA_BULAN[data.periode.bulan - 1].toUpperCase());
</script>

<svelte:head><title>REKAP INCOME {data.entity.code} {data.periode.tahun} - {bulan}</title></svelte:head>

<div class="cetak">
  <button type="button" class="tombol" onclick={() => window.print()}>Cetak / Simpan PDF</button>

  <h1>REKAP INCOME PUPUK {data.entity.legal_name.toUpperCase()} {data.periode.tahun}</h1>

  <table>
    <thead>
      <tr>
        <th rowspan="2">NO.</th>
        <th rowspan="2">NO. INVOICE</th>
        <th rowspan="2">KEGIATAN</th>
        <th rowspan="2">NO FAKTUR<br />PAJAK</th>
        <th rowspan="2">NO. STO/SPO</th>
        <th rowspan="2">LOKASI</th>
        <th>TANGGAL</th>
        <th rowspan="2">PARTY KG</th>
        <th colspan="3">PENAGIHAN WILMAR</th>
        <th rowspan="2">PAJAK</th>
        <th rowspan="2">NET<br />TAGIHAN</th>
        <th rowspan="2">TANGGAL<br />ENTRY TAGIHAN</th>
        <th rowspan="2">PAYMENT<br />DATE</th>
      </tr>
      <tr>
        <th>KEGIATAN</th>
        <th>HARGA</th>
        <th></th>
        <th>TOTAL</th>
      </tr>
      <tr><td colspan="15" class="banner">{bulan} {data.periode.tahun}</td></tr>
    </thead>
    <tbody>
      {#each data.baris as r, i (i)}
        <tr>
          <td class="c merah b">{i + 1}</td>
          <td class="merah b">{r.no_invoice ?? '-'}</td>
          <td class="merah b">{r.kegiatan}</td>
          <td class="c merah">{r.no_faktur_pajak ?? '-'}</td>
          <td class="c merah">{r.no_sto_spo ?? '-'}</td>
          <td class="merah">{r.lokasi ?? '-'}</td>
          <td class="c merah">{r.tanggal_kegiatan ?? '-'}</td>
          <td class="r b">{n(r.party_kg)} <small>KG</small></td>
          <td class="r b">{n(r.harga)}</td>
          <td class="c b">=</td>
          <td class="r b">{n(r.total)}</td>
          <td class="r b merah">{n(r.pajak)}</td>
          <td class="r b merah">{n(r.net_tagihan)}</td>
          <td class="c merah">{r.status_entry ? `${r.status_entry} ` : ''}{tgl(r.tanggal_entry)}</td>
          <td class="c merah b">{r.payment_date ? tgl(r.payment_date) : '-'}</td>
        </tr>
      {:else}
        <tr><td colspan="15" class="c b kosong">Tidak ada data rekap pendapatan untuk bulan {bulan} {data.periode.tahun}.</td></tr>
      {/each}
    </tbody>
    <tfoot>
      {#each [
        { label: 'TOTAL', j: data.bulanIni, kuning: false },
        { label: 'TOTAL KESELURUHAN PIUTANG', j: data.keseluruhan.semua, kuning: false },
        { label: 'TOTAL PIUTANG YANG BELUM TERBAYAR', j: data.keseluruhan.belum, kuning: true }
      ] as row (row.label)}
        <tr class:kuning={row.kuning}>
          <td colspan="7" class="c total">{row.label}</td>
          <td class="r total">{n(row.j.party_kg)} <small>KG</small></td>
          <td colspan="2"></td>
          <td class="r total">{n(row.j.total)}</td>
          <td class="r total">{n(row.j.pajak)}</td>
          <td class="r total">{n(row.j.net_tagihan)}</td>
          <td colspan="2"></td>
        </tr>
      {/each}
    </tfoot>
  </table>
</div>

<style>
  /* Paper, not screen: a copy of the operational spreadsheet, so plain black
     on white with its yellow banner rows rather than the app's theme tokens. */
  @page {
    size: A4 landscape;
    margin: 8mm;
  }
  :global(html),
  :global(body) {
    background: white !important;
    color: black !important;
  }
  .cetak {
    padding: 10px;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10px;
    color: black;
    background: white;
  }
  h1 {
    text-align: center;
    font-size: 14px;
    font-weight: 900;
    margin: 0 0 12px;
    padding-bottom: 6px;
    border-bottom: 2px solid black;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    border: 2px solid black;
  }
  th,
  td {
    border: 1px solid black;
    padding: 4px 5px;
    font-size: 9px;
    white-space: nowrap;
    vertical-align: middle;
  }
  th {
    font-weight: bold;
    text-align: center;
  }
  .banner,
  .kuning td {
    background: yellow;
    font-weight: 900;
  }
  .banner {
    text-align: center;
    font-size: 12px;
    letter-spacing: 1px;
    padding: 6px;
  }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: bold; }
  .merah { color: #c00; }
  .total { font-weight: 900; font-size: 10px; }
  .kosong { padding: 20px; }
  small { font-size: 8px; }
  .tombol {
    position: fixed;
    top: 12px;
    right: 12px;
    padding: 8px 14px;
    border: 1px solid black;
    border-radius: 6px;
    background: white;
    font-weight: bold;
    cursor: pointer;
  }
  @media print {
    .tombol { display: none; }
    .cetak { padding: 0; }
  }
</style>
