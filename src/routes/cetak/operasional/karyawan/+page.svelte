<script lang="ts">
  import { rentangTanggal } from '$lib/operasional/kegiatan';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const hariIni = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
</script>

<svelte:head><title>Laporan Rekam Jejak Karyawan {data.entity.code}</title></svelte:head>

<div class="cetak">
  <button type="button" class="tombol" onclick={() => window.print()}>Cetak / Simpan PDF</button>
  <h1>LAPORAN REKAM JEJAK &amp; CATATAN KARYAWAN</h1>
  <h2>{data.entity.legal_name.toUpperCase()}</h2>
  <p class="sub">Dicetak {hariIni}{data.filter.status !== 'all' ? ` · status ${data.filter.status}` : ''}{data.filter.sp !== 'all' ? ` · kinerja ${data.filter.sp}` : ''}</p>
  <table>
    <thead>
      <tr><th>No</th><th>Nama Karyawan</th><th>Jabatan</th><th>Keaktifan</th><th>Status Kinerja</th><th>Riwayat Catatan &amp; Surat Peringatan (SP)</th></tr>
    </thead>
    <tbody>
      {#each data.karyawan as k, i (k.id)}
        <tr>
          <td class="c">{i + 1}</td>
          <td class="b">{k.nama}</td>
          <td>{k.jabatan ?? '-'}</td>
          <td class="c">{k.status.toUpperCase()}</td>
          <td class="c b">{k.status_kinerja}</td>
          <td>
            {#each k.catatan as c, j (j)}
              <div>{rentangTanggal(c.tanggal, null)} · <b>{c.jenis}</b>{c.keterangan ? ` — ${c.keterangan}` : ''}</div>
            {:else}-{/each}
          </td>
        </tr>
      {:else}
        <tr><td colspan="6" class="c">Tidak ada data karyawan.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  /* Paper, not screen — black on white whatever the app theme is. */
  @page { size: A4 portrait; margin: 10mm; }
  :global(html), :global(body) { background: white !important; color: black !important; }
  .cetak { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: black; background: white; padding: 14px; }
  h1 { text-align: center; font-size: 14px; margin: 0; }
  h2 { text-align: center; font-size: 12px; margin: 2px 0; }
  .sub { text-align: center; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid black; padding: 4px 5px; vertical-align: top; }
  th { background: #eee; font-size: 9px; }
  .c { text-align: center; }
  .b { font-weight: bold; }
  .tombol { position: fixed; top: 12px; right: 12px; padding: 8px 14px; border: 1px solid black; border-radius: 6px; background: white; font-weight: bold; cursor: pointer; }
  @media print { .tombol { display: none; } .cetak { padding: 0; } }
</style>
