<script lang="ts">
  import { NAMA_BULAN } from '$lib/operasional/kegiatan';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const rp = (v: number) => 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(v);
  const t2 = (v: number) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const dicetak = new Date().toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
  const jumlah = $derived(
    data.baris.reduce(
      (a, r) => ({ trips: a.trips + r.trips, tonase: a.tonase + r.tonase, sangu: a.sangu + r.sangu_supir, terpal: a.terpal + r.terpal, ops: a.ops + r.operasional, total: a.total + r.total }),
      { trips: 0, tonase: 0, sangu: 0, terpal: 0, ops: 0, total: 0 }
    )
  );
</script>

<svelte:head><title>Laporan Biaya & Operasional Kapal {NAMA_BULAN[data.periode.bulan - 1]} {data.periode.tahun}</title></svelte:head>

<div class="cetak">
  <button type="button" class="tombol" onclick={() => window.print()}>Cetak / Simpan PDF</button>
  <header>
    <div>
      <p class="pt">{data.entity.legal_name.toUpperCase()}</p>
      <h1>LAPORAN BIAYA &amp; OPERASIONAL KAPAL</h1>
      <p class="kecil">Ringkasan Kegiatan Bongkaran, Tonnase, dan Operasional Per Rute Kapal</p>
    </div>
    <div class="kanan">
      <p>Periode: <b>{NAMA_BULAN[data.periode.bulan - 1]} {data.periode.tahun}</b></p>
      <p>Kapal Filter: <b>{data.namaKapalFilter ?? 'Semua Kapal'}</b></p>
      <p class="kecil">Dicetak: {dicetak} WIB</p>
    </div>
  </header>
  <table>
    <thead>
      <tr><th>No</th><th>Kapal</th><th>Rute</th><th>Trips</th><th>Tonnase (MT)</th><th>Sangu Sopir</th><th>Uang Terpal</th><th>Operasional</th><th>Total</th><th>Telly</th></tr>
    </thead>
    <tbody>
      {#each data.baris as r, i (r.id)}
        <tr>
          <td class="c">{i + 1}</td><td class="b">{r.nama_kapal}</td><td>{r.rute ?? '-'}</td><td class="c b">{r.trips}</td>
          <td class="r">{t2(r.tonase)}</td><td class="r">{rp(r.sangu_supir)}</td><td class="r">{rp(r.terpal)}</td>
          <td class="r">{rp(r.operasional)}</td><td class="r b">{rp(r.total)}</td><td>{r.telly ?? '-'}</td>
        </tr>
      {:else}
        <tr><td colspan="10" class="c">Tidak ada kegiatan kapal pada periode ini.</td></tr>
      {/each}
    </tbody>
    {#if data.baris.length}
      <tfoot>
        <tr>
          <td colspan="3" class="c">TOTAL KESELURUHAN</td><td class="c">{jumlah.trips}</td><td class="r">{t2(jumlah.tonase)}</td>
          <td class="r">{rp(jumlah.sangu)}</td><td class="r">{rp(jumlah.terpal)}</td><td class="r">{rp(jumlah.ops)}</td><td class="r">{rp(jumlah.total)}</td><td></td>
        </tr>
      </tfoot>
    {/if}
  </table>
</div>

<style>
  /* Paper, not screen — black on white whatever the app theme is. */
  @page { size: A4 landscape; margin: 10mm; }
  :global(html), :global(body) { background: white !important; color: black !important; }
  .cetak { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: black; background: white; padding: 16px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid black; padding-bottom: 10px; margin-bottom: 14px; }
  .pt { font-weight: 900; letter-spacing: 3px; font-size: 10px; margin: 0; }
  h1 { font-size: 18px; font-weight: 900; margin: 2px 0; }
  .kanan { text-align: right; }
  .kanan p { margin: 0 0 2px; }
  .kecil { font-size: 9px; color: #666; margin: 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 5px 6px; }
  th { background: #eee; font-size: 9px; text-transform: uppercase; }
  tfoot td { font-weight: 900; border-top: 2px solid black; }
  .c { text-align: center; }
  .r { text-align: right; white-space: nowrap; }
  .b { font-weight: bold; }
  .tombol { position: fixed; top: 12px; right: 12px; padding: 8px 14px; border: 1px solid black; border-radius: 6px; background: white; font-weight: bold; cursor: pointer; }
  @media print { .tombol { display: none; } .cetak { padding: 0; } }
</style>
