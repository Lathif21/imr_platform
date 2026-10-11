<script lang="ts">
  import ClipboardList from 'lucide-svelte/icons/clipboard-list';
  import Plus from 'lucide-svelte/icons/plus';
  import Printer from 'lucide-svelte/icons/printer';
  import Ship from 'lucide-svelte/icons/ship';
  import Wallet from 'lucide-svelte/icons/wallet';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, rentangTanggal, ton } from '$lib/operasional/kegiatan';
  import { BTN_PRIMARY, BTN_SOFT, rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const entityQuery = $derived(data.opEntity ? `entitas=${encodeURIComponent(data.opEntity.code)}` : '');
  const tambahHref = $derived(
    `/operasional/general?${entityQuery}&bulan=${data.periode.bulan}&tahun=${data.periode.tahun}&tambah=1`
  );

  const jumlah = $derived(
    data.baris.reduce(
      (acc, r) => ({
        trips: acc.trips + r.trips,
        tonase: acc.tonase + r.tonase,
        sangu: acc.sangu + r.sangu_supir,
        terpal: acc.terpal + r.terpal,
        operasional: acc.operasional + r.operasional,
        total: acc.total + r.total
      }),
      { trips: 0, tonase: 0, sangu: 0, terpal: 0, operasional: 0, total: 0 }
    )
  );

  function pilihKapal(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    const url = new URL(page.url);
    if (value) url.searchParams.set('kapal', value);
    else url.searchParams.delete('kapal');
    goto(url, { keepFocus: true, noScroll: true });
  }

  const TH = 'font-medium py-2.5 px-3';
  const TD_NUM = 'py-2.5 px-3 text-right num whitespace-nowrap';
</script>

<svelte:head><title>Detail Kegiatan Kapal · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-[15px] font-semibold text-foreground">Detail Kegiatan Kapal</h1>
      <p class="text-[12px] text-muted-foreground mt-0.5">
        Rekap biaya per kegiatan · {NAMA_BULAN[data.periode.bulan - 1]}
        {data.periode.tahun} · {data.baris.length} kegiatan
      </p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
      <label class="sr-only" for="filter-kapal">Kapal</label>
      <select
        id="filter-kapal"
        value={data.kapalFilter ?? ''}
        onchange={pilihKapal}
        class="h-[30px] px-2 bg-background border border-border rounded-md text-[12px] text-foreground focus:outline-none focus:border-primary max-w-[200px]"
      >
        <option value="">Semua kapal</option>
        {#each data.kapalBulanIni as k (k.id)}<option value={k.id}>{k.nama}</option>{/each}
      </select>
      <a
        href="/cetak/operasional/kegiatan?{entityQuery}&bulan={data.periode.bulan}&tahun={data.periode.tahun}{data.kapalFilter ? `&kapal=${data.kapalFilter}` : ''}"
        target="_blank"
        rel="noopener"
        class={BTN_SOFT}
      >
        <Printer size={14} /> Cetak
      </a>
      {#if data.canWrite}
        <a href={tambahHref} class={BTN_PRIMARY}><Plus size={14} /> Tambah Kegiatan</a>
      {/if}
    </div>
  </div>

  <div class="bg-card border border-border rounded-lg overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[1080px] text-[12px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="{TH} text-left">Kapal</th>
            <th class="{TH} text-left">Rute</th>
            <th class="{TH} text-right">Ritase</th>
            <th class="{TH} text-right">Tonase (MT)</th>
            <th class="{TH} text-right">Saku Supir</th>
            <th class="{TH} text-right">Terpal</th>
            <th class="{TH} text-right">Operasional</th>
            <th class="{TH} text-right">Total</th>
            <th class="{TH} text-left">Telly</th>
            <th class="{TH} text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each data.baris as row (row.id)}
            <tr class="border-b border-border/40 last:border-b-0 hover:bg-muted/40 align-top">
              <td class="py-2.5 px-3">
                <div class="inline-flex items-center gap-2 font-semibold text-foreground">
                  <Ship size={13} class="text-muted-foreground" />
                  {row.nama_kapal}
                </div>
                <div class="text-[11px] text-muted-foreground mt-0.5 pl-5 num">
                  {rentangTanggal(row.tanggal_kegiatan, row.tanggal_selesai)}
                </div>
              </td>
              <td class="py-2.5 px-3">{row.rute ?? '-'}</td>
              <td class={TD_NUM}>{row.trips}</td>
              <td class={TD_NUM}>{ton(row.tonase)}</td>
              <td class={TD_NUM}>{rupiah(row.sangu_supir)}</td>
              <td class={TD_NUM}>{rupiah(row.terpal)}</td>
              <td class={TD_NUM}>
                {#if row.operasional > 0 || row.tonase === 0}
                  {rupiah(row.operasional)}
                {:else}
                  <span class="text-warning" title="Belum diisi di Lengkapi Data. Perkiraan lama: tonase × Rp 1.000 = {rupiah(row.tonase * 1000)}">
                    Belum diisi
                  </span>
                {/if}
              </td>
              <td class="{TD_NUM} font-semibold text-foreground">{rupiah(row.total)}</td>
              <td class="py-2.5 px-3">
                {#if row.telly}{row.telly}{:else}<span class="text-subtle">—</span>{/if}
              </td>
              <td class="py-2 px-3">
                <div class="flex justify-end gap-1">
                  <a
                    href="/operasional/kegiatan/{row.id}?{entityQuery}"
                    class="h-[28px] px-2.5 rounded-md bg-primary/10 text-primary text-[11px] font-medium inline-flex items-center gap-1.5 hover:bg-primary/15 whitespace-nowrap"
                  >
                    <ClipboardList size={13} />
                    {data.canWrite ? 'Lengkapi Data' : 'Rincian'}
                  </a>
                  <a
                    href="/operasional/kegiatan/{row.id}/pembayaran?{entityQuery}"
                    class="h-[28px] px-2.5 rounded-md border border-border text-[11px] font-medium inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted whitespace-nowrap {row.jumlah_truk === 0 ? 'opacity-50 pointer-events-none' : ''}"
                    aria-disabled={row.jumlah_truk === 0}
                    title={row.jumlah_truk === 0 ? 'Isi daftar truk di Lengkapi Data lebih dulu' : 'Rincian Pembayaran Truk'}
                  >
                    <Wallet size={13} /> Pembayaran Truk
                  </a>
                </div>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="10" class="py-10 px-4 text-center text-[12px] text-muted-foreground">
                Belum ada kegiatan kapal untuk {NAMA_BULAN[data.periode.bulan - 1]} {data.periode.tahun}.
                {#if data.canWrite}<a href={tambahHref} class="text-primary hover:underline">Tambah kegiatan</a>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
        {#if data.baris.length > 0}
          <tfoot>
            <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
              <td class="py-2.5 px-3" colspan="2">TOTAL KESELURUHAN</td>
              <td class={TD_NUM}>{jumlah.trips}</td>
              <td class={TD_NUM}>{ton(jumlah.tonase)}</td>
              <td class={TD_NUM}>{rupiah(jumlah.sangu)}</td>
              <td class={TD_NUM}>{rupiah(jumlah.terpal)}</td>
              <td class={TD_NUM}>{rupiah(jumlah.operasional)}</td>
              <td class={TD_NUM}>{rupiah(jumlah.total)}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>
  </div>
</div>
