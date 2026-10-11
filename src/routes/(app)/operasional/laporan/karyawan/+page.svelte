<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Printer from 'lucide-svelte/icons/printer';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { rentangTanggal } from '$lib/operasional/kegiatan';
  import { BTN_SOFT, FIELD } from '$lib/operasional/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const entityQuery = $derived(`entitas=${encodeURIComponent(data.opEntity?.code ?? '')}`);
  const filterQuery = $derived(
    `${entityQuery}&status=${data.filter.status}&sp=${data.filter.sp}&cari=${encodeURIComponent(data.filter.cari)}`
  );

  const jumlah = $derived({
    total: data.karyawan.length,
    aktif: data.karyawan.filter((k) => k.status === 'aktif').length,
    nonaktif: data.karyawan.filter((k) => k.status !== 'aktif').length,
    catatan: data.karyawan.reduce((s, k) => s + k.catatan.length, 0)
  });

  function ubah(key: string, value: string) {
    const url = new URL(page.url);
    url.searchParams.set(key, value);
    goto(url, { keepFocus: true, noScroll: true, replaceState: key === 'cari' });
  }

  const KINERJA: Record<string, string> = {
    Normal: 'bg-positive/10 text-positive',
    SP1: 'bg-warning/10 text-warning',
    SP2: 'bg-warning/20 text-warning',
    SP3: 'bg-destructive/10 text-destructive'
  };
  const SELECT = 'h-[30px] px-2 bg-background border border-border rounded-md text-[12px] text-foreground focus:outline-none focus:border-primary';
</script>

<svelte:head><title>Laporan Catatan Karyawan · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <div>
      <a href="/operasional/laporan?{entityQuery}" class="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"><ArrowLeft size={13} /> Laporan</a>
      <h1 class="text-[15px] font-semibold text-foreground mt-1">Laporan Rekam Jejak &amp; Catatan Karyawan</h1>
      <p class="text-[12px] text-muted-foreground mt-0.5">
        {jumlah.total} karyawan · {jumlah.aktif} aktif · {jumlah.nonaktif} nonaktif · {jumlah.catatan} catatan
      </p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <select value={data.filter.status} onchange={(e) => ubah('status', e.currentTarget.value)} aria-label="Status keaktifan" class={SELECT}>
        <option value="all">Semua status</option><option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option>
      </select>
      <select value={data.filter.sp} onchange={(e) => ubah('sp', e.currentTarget.value)} aria-label="Status kinerja" class={SELECT}>
        <option value="all">Semua kinerja</option><option value="Normal">Normal</option><option value="SP1">SP1</option><option value="SP2">SP2</option><option value="SP3">SP3</option>
      </select>
      <input type="search" value={data.filter.cari} onchange={(e) => ubah('cari', e.currentTarget.value)} placeholder="Cari nama atau jabatan…" aria-label="Cari karyawan" class="{FIELD} w-[200px]" />
      <a href="/cetak/operasional/karyawan?{filterQuery}" target="_blank" rel="noopener" class={BTN_SOFT}><Printer size={14} /> Cetak</a>
    </div>
  </div>

  <div class="bg-card border border-border rounded-lg overflow-x-auto">
    <table class="w-full min-w-[860px] text-[12px]">
      <thead>
        <tr class="text-muted-foreground border-b border-border">
          <th class="font-medium py-2.5 px-3 text-center w-[44px]">No</th>
          <th class="font-medium py-2.5 px-3 text-left">Karyawan &amp; Jabatan</th>
          <th class="font-medium py-2.5 px-3 text-left">Keaktifan</th>
          <th class="font-medium py-2.5 px-3 text-left">Status Kinerja</th>
          <th class="font-medium py-2.5 px-3 text-left">Tgl Bergabung</th>
          <th class="font-medium py-2.5 px-3 text-left">Riwayat Catatan &amp; SP</th>
        </tr>
      </thead>
      <tbody>
        {#each data.karyawan as k, i (k.id)}
          <tr class="border-b border-border/40 align-top hover:bg-muted/40">
            <td class="py-2.5 px-3 text-center text-muted-foreground num">{i + 1}</td>
            <td class="py-2.5 px-3">
              <div class="font-semibold text-foreground">{k.nama}</div>
              <div class="text-[11px] text-muted-foreground">{k.jabatan ?? '—'}</div>
            </td>
            <td class="py-2.5 px-3 capitalize">{k.status}</td>
            <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded-full text-[11px] font-medium {KINERJA[k.status_kinerja] ?? ''}">{k.status_kinerja}</span></td>
            <td class="py-2.5 px-3 num">{rentangTanggal(k.tanggal_bergabung, null)}</td>
            <td class="py-2.5 px-3">
              {#each k.catatan as c, j (j)}
                <div class="text-[11px]"><span class="num text-muted-foreground">{rentangTanggal(c.tanggal, null)}</span> · <b>{c.jenis}</b>{c.keterangan ? ` — ${c.keterangan}` : ''}</div>
              {:else}
                <span class="text-subtle">—</span>
              {/each}
            </td>
          </tr>
        {:else}
          <tr><td colspan="6" class="py-10 text-center text-muted-foreground">Tidak ada karyawan yang cocok.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="text-[11px] text-muted-foreground">
    Catatan dan SP ditambahkan di <a href="/operasional/karyawan?{entityQuery}" class="text-primary hover:underline">Master Karyawan</a>.
  </p>
</div>
