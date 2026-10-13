<script lang="ts">
  import { NAMA_BULAN, ton } from '$lib/operasional/kegiatan';
  import { judulKapal, labelPajakInvoice } from '$lib/operasional/laporan-kapal';
  import { labelPersen } from '$lib/operasional/pajak';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  /** The sheet's style: "Rp" left, the figure right, zero as "-". */
  const angka = (v: number) => (v === 0 ? '-' : new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(v));
  const periode = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`.toUpperCase());
  const pt = $derived(data.entity.legal_name.toUpperCase());
</script>

{#snippet rp(v: number)}<span class="rp"><span>Rp</span><span>{angka(v)}</span></span>{/snippet}

<svelte:head>
  <title>Laporan per Kapal {data.laporan.length === 1 ? judulKapal(data.laporan[0]) : ''} {periode}</title>
</svelte:head>

<button type="button" class="tombol" onclick={() => window.print()}>Cetak / Simpan PDF</button>

{#each data.laporan as l (l.kapal_id)}
  <!-- Halaman 1 — rincian kegiatan dan biaya operasional -->
  <section class="hal lanskap">
    <p class="judul">RINCIAN KEGIATAN OPERASIONAL {pt}</p>
    <p class="judul periode"><span>PERIODE</span><span>: {periode}</span></p>

    <table class="lebar">
      <thead>
        <tr><th colspan="10" class="pita kuning">{judulKapal(l).toUpperCase()}</th></tr>
        <tr>
          <th class="no">No.</th><th>NO. INVOICE</th><th>NO. SPO/SPK</th><th>RUTE</th><th>TONASE (MT)</th><th>HARGA OA</th>
          <th>TAGIHAN WILMAR</th><th>{labelPajakInvoice(l.invoice)}</th><th>PAJAK PPN</th><th>PENCAIRAN</th>
        </tr>
      </thead>
      <tbody>
        {#each l.invoice as i, n (n)}
          <tr>
            <td class="r">{n + 1}</td><td>{i.no_invoice ?? '-'}</td><td class="c">{i.no_spo ?? '-'}</td><td class="c">{i.rute}</td>
            <td class="r">{ton(i.tonase)}</td><td class="r">{angka(i.harga)}</td>
            <td>{@render rp(i.tagihan)}</td><td>{@render rp(i.pajak)}</td><td>{@render rp(0)}</td><td>{@render rp(i.pencairan)}</td>
          </tr>
        {:else}
          <tr><td colspan="10" class="c miring">Belum ada invoice untuk kegiatan kapal ini di Laporan Pendapatan.</td></tr>
        {/each}
        <tr class="hijau b">
          <td colspan="4" class="c">GRAND TOTAL</td>
          <td class="r">{ton(l.jumlahInvoice.tonase)}</td><td></td>
          <td>{@render rp(l.jumlahInvoice.tagihan)}</td><td>{@render rp(l.jumlahInvoice.pajak)}</td><td>{@render rp(0)}</td><td>{@render rp(l.jumlahInvoice.pencairan)}</td>
        </tr>
      </tbody>
    </table>

    <table class="biaya">
      <thead>
        <tr><th colspan="3" class="kiri">BIAYA OPERASIONAL <span class="titik">:</span></th></tr>
        <tr><th class="no">No.</th><th>JENIS OPERASIONAL</th><th class="kiri">JUMLAH BIAYA</th></tr>
      </thead>
      <tbody>
        <tr><td class="r">1</td><td>OPERASIONAL TELLY</td><td>{@render rp(l.biaya.operasional)}</td></tr>
        <tr><td class="r">2</td><td>PBM</td><td>{@render rp(l.biaya.pbm)}</td></tr>
        <tr><td class="r">3</td><td>REKANAN</td><td>{@render rp(l.biaya.rekanan)}</td></tr>
        <tr class="merah b"><td colspan="2" class="c">TOTAL</td><td>{@render rp(l.biaya.total)}</td></tr>
        <tr class="biru b"><td colspan="2" class="c">NET PENDAPATAN</td><td>{@render rp(l.net_pendapatan)}</td></tr>
      </tbody>
    </table>

    {#if l.catatan.length}
      <ul class="catatan">{#each l.catatan as c, n (n)}<li>{c}</li>{/each}</ul>
    {/if}
  </section>

  <!-- Halaman 2 — rincian rekanan per rute -->
  <section class="hal">
    <table class="muatan">
      <thead>
        <tr><th colspan="2" class="kiri">RINCIAN REKANAN <span class="titik">:</span></th></tr>
        <tr><th>NAMA</th><th>MUAT</th></tr>
      </thead>
      <tbody>
        {#each l.rute as r (r.kegiatan_id)}
          <tr class="biru-muda b"><td colspan="2" class="c">{r.rute}</td></tr>
          {#each r.pemilik as g (g.pemilik_id)}
            <tr><td>{g.nama}</td><td class="r">{ton(g.jumlah.muat)}</td></tr>
          {/each}
          <tr class="kuning b"><td></td><td class="r">{ton(r.jumlah.muat)}</td></tr>
        {/each}
        <tr class="hijau b"><td class="c">TOTAL MUATAN</td><td class="r">{ton(l.jumlahRekanan.muat)}</td></tr>
      </tbody>
    </table>

    {#each l.rute as r (r.kegiatan_id)}
      <p class="judul rute">RUTE {r.rute}{r.no_spo ? ` (SPO/SPK.${r.no_spo})` : ''}</p>
      <table class="truk">
        <colgroup><col class="w-nopol" /><col /><col /><col class="w-rp" /><col class="w-rp" /><col class="w-rp" /><col class="w-rp" /></colgroup>
        <tbody>
          {#each r.pemilik as g (g.pemilik_id)}
            <tr class="abu b"><td colspan="7" class="c">{g.nama}</td></tr>
            <tr class="kepala"><td>NOPOL</td><td>MUAT</td><td>RIT</td><td>BIAYA ANGKUT</td><td>JUMLAH</td><td>SAKU</td><td>TERPAL</td></tr>
            {#each g.truk as t, n (n)}
              <tr>
                <td class="c">{t.nopol}</td><td class="r">{ton(t.muat)}</td><td class="r">{t.rit}</td>
                <td>{@render rp(t.biaya_angkut)}</td><td>{@render rp(t.jumlah)}</td><td>{@render rp(t.saku)}</td><td>{@render rp(t.terpal)}</td>
              </tr>
            {/each}
            <tr class="kuning b">
              <td class="c">TOTAL</td><td class="r">{ton(g.jumlah.muat)}</td><td class="r">{g.jumlah.rit}</td><td></td>
              <td>{@render rp(g.jumlah.jumlah)}</td><td>{@render rp(g.jumlah.saku)}</td><td>{@render rp(g.jumlah.terpal)}</td>
            </tr>
            <tr class="jeda"><td colspan="7"></td></tr>
          {:else}
            <tr><td colspan="7" class="c miring">Belum ada truk pada kegiatan ini.</td></tr>
          {/each}
          <tr class="hijau b">
            <td class="c">TOTAL PARTY</td><td class="r">{ton(r.jumlah.muat)}</td><td class="r">{r.jumlah.rit}</td><td></td>
            <td>{@render rp(r.jumlah.jumlah)}</td><td>{@render rp(r.jumlah.saku)}</td><td>{@render rp(r.jumlah.terpal)}</td>
          </tr>
        </tbody>
      </table>
    {/each}

    <table class="truk grand">
      <colgroup><col class="w-nopol" /><col /><col /><col class="w-rp" /><col class="w-rp" /><col class="w-rp" /><col class="w-rp" /></colgroup>
      <tbody>
        <tr class="biru b">
          <td class="c">GRAND TOTAL</td><td class="r">{ton(l.jumlahRekanan.muat)}</td><td class="r">{l.jumlahRekanan.rit}</td><td></td>
          <td>{@render rp(l.jumlahRekanan.jumlah)}</td><td>{@render rp(l.jumlahRekanan.saku)}</td><td>{@render rp(l.jumlahRekanan.terpal)}</td>
        </tr>
      </tbody>
    </table>
  </section>

  <!-- Halaman 3 — pembayaran rekanan -->
  <section class="hal">
    <table class="bayar">
      <tbody>
        <tr><th colspan="6" class="pita kuning">PEMBAYARAN REKANAN</th></tr>
        {#each l.pembayaran as p, n (p.pemilik_id)}
          {#if n > 0}<tr class="jeda"><td colspan="6"></td></tr>{/if}
          <tr><td colspan="6" class="c b">{p.nama}</td></tr>
          <tr class="kepala"><td>RUTE PENGIRIMAN</td><td>MUATAN</td><td>RIT</td><td>JUMLAH BRUTO</td><td>UANG SAKU</td><td>TERPAL</td></tr>
          {#each p.rute as r, i (i)}
            <tr>
              <td class="r">{r.rute}</td><td class="r">{ton(r.muat)}</td><td class="r">{r.rit}</td>
              <td>{@render rp(r.bruto)}</td><td>{@render rp(r.saku)}</td><td>{@render rp(r.terpal)}</td>
            </tr>
          {/each}
          <tr class="merah b"><td colspan="3" class="c">TOTAL REKANAN</td><td>{@render rp(p.bruto)}</td><td>{@render rp(p.saku)}</td><td>{@render rp(p.terpal)}</td></tr>
          <tr class="merah b"><td colspan="3" class="c">PAJAK {labelPersen(p.persen_pajak)}</td><td colspan="3">{@render rp(p.pajak)}</td></tr>
          <tr class="merah b"><td colspan="3" class="c">NET PEMBAYARAN</td><td colspan="3">{@render rp(p.net)}</td></tr>
        {:else}
          <tr><td colspan="6" class="c miring">Belum ada truk rekanan pada kapal ini.</td></tr>
        {/each}
      </tbody>
    </table>

    {#if l.pembayaran.length}
      <table class="rekening">
        <thead><tr><th>NAMA REKANAN</th><th>NET PEMBAYARAN</th><th>ATAS NAMA</th><th>NO. REKENING</th><th>NAMA BANK</th></tr></thead>
        <tbody>
          {#each l.pembayaran as p (p.pemilik_id)}
            <tr>
              <td class="c">{p.nama}</td><td>{@render rp(p.net)}</td><td class="c">{p.rekening_atas_nama ?? ''}</td>
              <td class="c">{p.no_rekening ?? ''}</td><td class="c">{p.nama_bank ?? ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
{:else}
  <section class="hal"><p class="judul">Tidak ada kegiatan kapal pada periode {periode}.</p></section>
{/each}

<style>
  /* Paper, not screen — black on white whatever the app theme is. Colours are
     the user's sheet (KM SANEI.pdf), not app tokens. Page 1 is landscape,
     pages 2 and 3 portrait, as in the sheet. */
  @page { size: A4 portrait; margin: 10mm; }
  @page lanskap { size: A4 landscape; margin: 10mm; }
  :global(html), :global(body) { background: white !important; color: black !important; }

  .hal { font-family: Calibri, Carlito, Arial, Helvetica, sans-serif; font-size: 11px; color: black; background: white; padding: 16px; break-after: page; }
  .hal:last-of-type { break-after: auto; }
  .lanskap { page: lanskap; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .judul { font-weight: bold; margin: 0; }
  .periode { display: flex; gap: 0; margin-bottom: 14px; }
  .periode span:first-child { display: inline-block; width: 110px; padding-left: 4px; }
  .rute { margin: 16px 0 2px; }

  table { border-collapse: collapse; }
  /* Row height of the sheet (≈15pt), so a ship of 25 trucks still fits page 2. */
  th, td { border: 1px solid black; padding: 1px 5px; line-height: 1.3; }
  th { font-weight: bold; text-align: center; white-space: nowrap; }
  .lebar { width: 100%; margin-bottom: 18px; }
  .biaya { width: 330px; }
  .muatan { width: 290px; margin-bottom: 16px; }
  .truk, .bayar, .rekening { width: 100%; }
  .bayar { margin-bottom: 16px; }
  .grand { margin-top: 14px; }
  .w-nopol { width: 19%; }
  .w-rp { width: 15%; }

  .no { width: 22px; }
  .kiri { text-align: left; }
  .titik { float: right; }
  .c { text-align: center; }
  .r { text-align: right; white-space: nowrap; }
  .b td, .b { font-weight: bold; }
  .miring { font-style: italic; }
  .kepala td { font-weight: bold; text-align: center; }
  .jeda td { height: 12px; }

  .rp { display: flex; justify-content: space-between; gap: 8px; white-space: nowrap; }

  .pita { font-size: 12px; }
  .kuning, .kuning td { background: #fff2cc; }
  .hijau td { background: #e2efda; }
  .merah td { background: #fce4d6; }
  .biru td { background: #ddebf7; }
  .biru-muda td { background: #ddebf7; }
  .abu td { background: #f2f2f2; }

  .catatan { margin: 12px 0 0; padding-left: 16px; font-size: 9px; font-style: italic; color: #555; }

  .tombol { position: fixed; top: 12px; right: 12px; padding: 8px 14px; border: 1px solid black; border-radius: 6px; background: white; font-weight: bold; cursor: pointer; z-index: 1; }
  @media print { .tombol { display: none; } .hal { padding: 0; } }
</style>
