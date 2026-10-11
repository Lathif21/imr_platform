<script lang="ts">
  import { NAMA_BULAN } from '$lib/operasional/kegiatan';
  import { pendapatanKartu, ringkasLabaRugi } from '$lib/operasional/kumpulan';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const n = (v: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(v);
  const nAtauStrip = (v: number) => (v > 0 ? n(v) : '-');
  const bulan = $derived(NAMA_BULAN[data.periode.bulan - 1].toUpperCase());
  const hariTerakhir = $derived(new Date(data.periode.tahun, data.periode.bulan, 0).getDate());
  const lr = $derived(ringkasLabaRugi(data.kumpulan.cards, data.kumpulan.pengeluaran));
</script>

<svelte:head><title>Kumpulan Laporan {bulan} {data.periode.tahun}</title></svelte:head>

<div class="cetak">
  <button type="button" class="tombol" onclick={() => window.print()}>Cetak / Simpan PDF</button>
  <div class="tata">
    <div>
      <div class="judul">RINCIAN KEGIATAN OPERASIONAL {data.entity.legal_name.toUpperCase()}</div>
      <div class="sub">PERIODE : {bulan} {data.periode.tahun}</div>
      <div class="kartu-grid">
        {#each data.kumpulan.cards as c, i (i)}
          <div class="kartu">
            <div class="baris"><span>KAPAL</span><span class="kiri tebal">: {c.kegiatan}</span></div>
            <div class="baris"><span>TELLY</span><span class="kiri">: {c.telly}</span></div>
            <div class="baris"><span>MUATAN</span><span>: {n(c.muatan_mt)} MT</span></div>
            <div class="baris"><span>RITASE</span><span>: {n(c.ritase)} RIT</span></div>
            <div class="baris"><span>TAGIHAN</span><span>Rp {n(c.tagihan)}</span></div>
            <div class="baris"><span>PAJAK</span><span>Rp {nAtauStrip(c.pajak)}</span></div>
            <div class="baris"><span>REKANAN</span><span>Rp {nAtauStrip(c.rekanan)}</span></div>
            <div class="baris"><span>ONGKOS PBM</span><span>Rp {nAtauStrip(c.ongkos_pbm)}</span></div>
            <div class="baris"><span>TERPAL (50%)</span><span>Rp {nAtauStrip(c.terpal_50)}</span></div>
            <div class="baris"><span>OPERASIONAL</span><span>Rp {nAtauStrip(c.operasional)}</span></div>
            <div class="baris garis"><span>PENDAPATAN</span><span>Rp {n(pendapatanKartu(c))}</span></div>
          </div>
        {:else}
          <div class="kartu kosong">Belum ada data pendapatan kapal pada periode ini.</div>
        {/each}
      </div>
    </div>

    <table class="lr">
      <thead>
        <tr><th colspan="3">Laporan Laba Rugi</th></tr>
        <tr><th colspan="3">{data.entity.legal_name}</th></tr>
        <tr><th colspan="3" class="normal">Per {hariTerakhir} {NAMA_BULAN[data.periode.bulan - 1]} {data.periode.tahun}</th></tr>
      </thead>
      <tbody>
        <tr class="bagian"><td colspan="3">PENDAPATAN</td></tr>
        {#each [['Tagihan Wilmar', lr.tagihan_wilmar, false], ['Pajak (0,5%)', lr.pajak, false], ['Rekanan', lr.rekanan, false], ['PBM', lr.pbm, true], ['Terpal (50%)', lr.terpal_50, true], ['Operasional Telly', lr.operasional_telly, false]] as [label, v, strip] (label)}
          <tr><td class="isi">{label}</td><td class="r">Rp</td><td class="r">{strip ? nAtauStrip(v as number) : n(v as number)}</td></tr>
        {/each}
        <tr class="tebal abu"><td>Pendapatan Operasional</td><td class="r">Rp</td><td class="r">{n(lr.pendapatan_operasional)}</td></tr>
        <tr class="bagian"><td colspan="3">PENGELUARAN</td></tr>
        {#each [['Gaji Karyawan', lr.gaji_karyawan, false], ['Sewa Kantor', lr.sewa_kantor, true], ['PPh Sewa Kantor', lr.pph_sewa_kantor, true], ['Atensi Jalan', lr.atensi_jalan, false], ['Beban Kantor, ATK, dll', lr.beban_kantor, false]] as [label, v, strip] (label)}
          <tr><td class="isi">{label}</td><td class="r">Rp</td><td class="r">{strip ? nAtauStrip(v as number) : n(v as number)}</td></tr>
        {/each}
        <tr class="tebal merah"><td>Pengeluaran Total</td><td class="r">Rp</td><td class="r">{n(lr.total_pengeluaran)}</td></tr>
        <tr class="tebal besar"><td>PENDAPATAN BERSIH</td><td class="r">Rp</td><td class="r">{n(lr.pendapatan_bersih)}</td></tr>
        {#if data.kumpulan.notes}
          <tr><td colspan="3" class="catatan">Catatan: {data.kumpulan.notes}</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  /* Paper, not screen — black on white whatever the app theme is. */
  @page { size: A4 landscape; margin: 8mm; }
  :global(html), :global(body) { background: white !important; color: black !important; }
  .cetak { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: black; background: white; padding: 12px; }
  .tata { display: grid; grid-template-columns: 1fr 300px; gap: 16px; align-items: start; }
  .judul { font-weight: 900; font-size: 12px; text-align: center; }
  .sub { text-align: center; font-weight: bold; margin: 2px 0 10px; }
  .kartu-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .kartu { border: 1px solid black; padding: 6px 8px; }
  .kartu.kosong { grid-column: span 2; text-align: center; padding: 20px; }
  .baris { display: flex; justify-content: space-between; padding: 1px 0; }
  .baris span:first-child { font-weight: bold; width: 90px; }
  .baris span:last-child { flex: 1; text-align: right; }
  .baris .kiri { text-align: left !important; }
  .garis { border-top: 1px solid black; margin-top: 3px; padding-top: 3px; font-weight: 900; }
  .lr { width: 100%; border-collapse: collapse; border: 1px solid black; }
  .lr th { font-size: 11px; padding: 3px; text-align: center; }
  .lr th.normal { font-weight: normal; font-size: 9.5px; }
  .lr td { padding: 3px 6px; border-top: 1px solid #ddd; }
  .bagian td { font-weight: 900; background: #eee; }
  .isi { padding-left: 14px !important; }
  .r { text-align: right; }
  .tebal td { font-weight: 900; }
  .abu td { background: #f9fafb; }
  .merah td { color: #c00; background: #fef2f2; }
  .besar td { font-size: 11px; border-top: 2px solid black; }
  .catatan { font-style: italic; }
  .tebal { font-weight: 900; }
  .tombol { position: fixed; bottom: 12px; right: 12px; padding: 8px 14px; border: 1px solid black; border-radius: 6px; background: white; font-weight: bold; cursor: pointer; }
  @media print { .tombol { display: none; } .cetak { padding: 0; } }
</style>
