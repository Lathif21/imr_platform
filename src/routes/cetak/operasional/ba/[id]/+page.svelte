<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const rp = (v: number) => 'Rp ' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(v);
  const n = (v: number, d = 0) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const hariIni = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
</script>

<svelte:head><title>Berita Acara {data.noBa}</title></svelte:head>

<div class="cetak">
  <div class="bar">
    <span>Berita Acara Pemuatan · {data.noBa}</span>
    <button type="button" onclick={() => window.print()}>Cetak / Simpan PDF</button>
  </div>

  <article>
    <header class="kop">
      <div class="identitas-kop">
        <div class="logo">IMR</div>
        <div>
          <h2>{data.entity.legal_name.toUpperCase()}</h2>
          <p>Jasa Pengangkutan, Logistik, &amp; Pemuatan Pupuk Pelabuhan</p>
          <!-- Sama persis dengan Laravel (keputusan pemilik sistem, 12 Okt 2026). -->
          <p class="alamat">Jl. Raya Pelabuhan Utama No. 88 • Email: operational@indomodaraya.co.id</p>
        </div>
      </div>
      <div class="kanan">
        <span class="lencana">DOKUMEN RESMI PENAGIHAN</span>
        <p>Tanggal: {hariIni}</p>
      </div>
    </header>

    <div class="judul">
      <h1>BERITA ACARA SERAH TERIMA &amp; SELESAI KEGIATAN PEMUATAN</h1>
      <p>NOMOR: {data.noBa}</p>
    </div>

    <p class="pembuka">
      Pada hari ini, diselesaikan dan diverifikasi bersama kegiatan pemuatan serta pengangkutan barang pupuk oleh
      <strong>{data.entity.legal_name}</strong> dengan rincian data operasional sebagai berikut:
    </p>

    <dl class="identitas">
      <div><dt>Nama Kegiatan / Kapal</dt><dd class="tebal">{String(data.item.kegiatan).toUpperCase()}</dd></div>
      <div><dt>No. Invoice Penagihan</dt><dd class="tebal">{data.item.no_invoice ?? '-'}</dd></div>
      <div><dt>Lokasi / Rute</dt><dd>{data.item.lokasi ?? '-'}</dd></div>
      <div><dt>No. STO / SPO</dt><dd>{data.item.no_sto_spo ?? '-'}</dd></div>
      <div><dt>Tanggal Kegiatan</dt><dd>{data.item.tanggal_kegiatan ?? '-'}</dd></div>
      <div><dt>No. Faktur Pajak</dt><dd>{data.item.no_faktur_pajak ?? '-'}</dd></div>
    </dl>

    <table>
      <thead>
        <tr>
          <th>Uraian Pekerjaan</th>
          <th>Hasil Party (KG)</th>
          <th>Muatan (MT)</th>
          <th class="r">Harga (Rp/Ton)</th>
          <th class="r">Total Penagihan</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>Kegiatan Pemuatan &amp; Pengangkutan Cargo Pupuk</strong><br />
            <small>Telly Penanggung Jawab: {data.telly || '-'}</small>
          </td>
          <td class="c tebal">{n(data.item.party_kg)} KG</td>
          <td class="c tebal">{n(data.item.party_kg / 1000, 2)} MT</td>
          <td class="r tebal">{rp(data.item.harga)}</td>
          <td class="r tebal">{rp(data.item.total)}</td>
        </tr>
        <tr class="abu">
          <td colspan="4" class="r">Potongan Pajak PPh ({n(data.item.tarif_pajak, 1)}%):</td>
          <td class="r tebal">- {rp(data.item.pajak)}</td>
        </tr>
        <tr class="net">
          <td colspan="4" class="r">NET TAGIHAN DITERIMA (NETTO):</td>
          <td class="r">{rp(data.item.net_tagihan)}</td>
        </tr>
      </tbody>
    </table>

    <div class="pernyataan">
      <p><strong>PERNYATAAN VERIFIKASI DOKUMEN:</strong></p>
      <p>
        1. Seluruh hasil rekapitulasi timbangan dan kuantitas barang yang tertera di atas telah diverifikasi dan
        disetujui bersama tanpa ada sanggahan.
      </p>
      <p>
        2. Berita Acara (BAP) ini merupakan bukti fisik sah kelengkapan berkas penagihan untuk diteruskan kepada
        <strong>Departemen Accounting</strong> guna proses verifikasi dan pencairan dana (estimasi 14 hari kerja
        terhitung sejak BAP diterbitkan).
      </p>
    </div>

    <div class="ttd">
      {#each [
        { pihak: 'PIHAK VENDOR / JETTY', nama: 'Pimpinan Pelabuhan / Jetty / Produksi', ket: '( Tanda Tangan & Stempel )', ttd: '( ____________________ )', jabatan: 'PIC Jetty / Produksi' },
        { pihak: 'PELAKSANA PEMUATAN', nama: data.entity.legal_name.toUpperCase(), ket: '( Tanda Tangan & Stempel )', ttd: `( ${data.pembuat} )`, jabatan: 'Admin Operasional' },
        { pihak: 'PENERIMA BERKAS PENAGIHAN', nama: 'Departemen Accounting', ket: '( Tanda Tangan & Tanggal Terima )', ttd: '( ____________________ )', jabatan: 'Finance & Accounting' }
      ] as p (p.pihak)}
        <div class="kotak">
          <div>
            <p class="kecil">{p.pihak}</p>
            <p class="tebal">{p.nama}</p>
          </div>
          <p class="miring">{p.ket}</p>
          <div class="garis">
            <p class="tebal">{p.ttd}</p>
            <p class="kecil">{p.jabatan}</p>
          </div>
        </div>
      {/each}
    </div>
  </article>
</div>

<style>
  /* Paper, not screen — black on white whatever the app theme is. */
  @page {
    size: A4 portrait;
    margin: 12mm;
  }
  :global(html),
  :global(body) {
    background: white !important;
    color: black !important;
  }
  .cetak {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    color: black;
    background: white;
    padding: 24px;
  }
  .bar {
    max-width: 800px;
    margin: 0 auto 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: bold;
  }
  .bar button {
    padding: 8px 14px;
    border: 1px solid black;
    border-radius: 6px;
    background: white;
    font-weight: bold;
    cursor: pointer;
  }
  article {
    max-width: 800px;
    margin: 0 auto;
    padding: 28px;
    border: 1px solid #ccc;
  }
  .kop {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 4px solid black;
    padding-bottom: 12px;
    margin-bottom: 20px;
  }
  .kop h2 { margin: 0; font-size: 20px; font-weight: 900; }
  .kop p { margin: 2px 0 0; font-size: 11px; }
  .identitas-kop { display: flex; align-items: center; gap: 14px; }
  .logo {
    width: 56px;
    height: 56px;
    border-radius: 10px;
    background: black;
    color: white;
    font-weight: 900;
    font-size: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .alamat { color: #888; font-size: 10px !important; }
  .kanan { text-align: right; }
  .lencana { display: inline-block; border: 1px solid #999; padding: 3px 8px; font-size: 9px; font-weight: bold; letter-spacing: 1px; }
  .judul { text-align: center; margin: 20px 0; }
  .judul h1 { display: inline-block; margin: 0; font-size: 15px; font-weight: 900; border-bottom: 2px solid black; padding-bottom: 3px; }
  .judul p { margin: 4px 0 0; font-weight: bold; font-size: 11px; }
  .pembuka { line-height: 1.6; margin-bottom: 16px; }
  .identitas {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 24px;
    border: 1px solid #999;
    padding: 12px;
    margin: 0 0 20px;
  }
  .identitas div { display: flex; }
  .identitas dt { width: 150px; color: #555; }
  .identitas dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; border: 2px solid black; margin-bottom: 20px; }
  th, td { padding: 8px; border: 1px solid #999; }
  th { background: black; color: white; text-align: center; font-size: 11px; }
  .abu td { background: #f2f2f2; }
  .net td { border-top: 2px solid black; font-weight: 900; font-size: 13px; }
  .pernyataan { border: 1px solid #999; padding: 12px; font-size: 11px; line-height: 1.6; margin-bottom: 28px; }
  .pernyataan p { margin: 0 0 4px; }
  .ttd { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; text-align: center; }
  .kotak { border: 1px solid #999; padding: 10px; height: 170px; display: flex; flex-direction: column; justify-content: space-between; }
  .kotak p { margin: 0; }
  .garis { border-top: 1px solid #999; padding-top: 4px; }
  .kecil { font-size: 9px; color: #555; }
  .miring { font-style: italic; font-size: 9px; color: #777; }
  .tebal { font-weight: bold; }
  .c { text-align: center; }
  .r { text-align: right; }
  @media print {
    .bar { display: none; }
    .cetak { padding: 0; }
    article { border: none; padding: 0; }
  }
</style>
