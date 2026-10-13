<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Printer from 'lucide-svelte/icons/printer';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, rentangTanggal, ton } from '$lib/operasional/kegiatan';
  import { BTN_SOFT, rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const q = $derived(`entitas=${encodeURIComponent(data.opEntity?.code ?? '')}&bulan=${data.periode.bulan}&tahun=${data.periode.tahun}`);
  const namaBulan = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`);
  const KOLOM = ['rekanan', 'sangu_supir', 'terpal', 'operasional', 'paguyuban', 'telly', 'total'] as const;
  const jumlah = $derived(
    Object.fromEntries(KOLOM.map((k) => [k, data.ringkas.reduce((s, r) => s + r[k], 0)])) as Record<(typeof KOLOM)[number], number>
  );

  const TH = 'font-semibold py-2.5 px-3 whitespace-nowrap';
  const TD = 'py-2.5 px-3 text-right num whitespace-nowrap';
</script>

<svelte:head><title>Laporan Operasional · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <div>
      <a href="/operasional/laporan?{q}" class="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft size={13} /> Laporan</a>
      <h1 class="text-[17px] font-semibold text-foreground mt-1">Laporan Operasional</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">Rekap biaya per kapal · {namaBulan}</p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
      <a href="/cetak/operasional/kegiatan?{q}" target="_blank" rel="noopener" class={BTN_SOFT}><Printer size={14} /> Cetak Biaya &amp; Operasional</a>
    </div>
  </div>

  <section class="space-y-2">
    <h2 class="text-[14px] font-semibold text-foreground">Ringkasan per kapal</h2>
    <div class="bg-card border border-border rounded-lg overflow-x-auto">
      <table class="w-full min-w-[1100px] text-[13px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="{TH} text-left">Kapal</th>
            <th class="{TH} text-right">Kegiatan</th>
            <th class="{TH} text-right">Truk</th>
            <th class="{TH} text-right">Ritase</th>
            <th class="{TH} text-right">Tonase (MT)</th>
            <th class="{TH} text-right">Beban Rekanan</th>
            <th class="{TH} text-right">Saku Supir</th>
            <th class="{TH} text-right">Terpal</th>
            <th class="{TH} text-right">Operasional</th>
            <th class="{TH} text-right">Paguyuban</th>
            <th class="{TH} text-right">Honor Telly</th>
            <th class="{TH} text-right">Total Biaya</th>
          </tr>
        </thead>
        <tbody>
          {#each data.ringkas as r (r.kapal_id)}
            <tr class="border-b border-border/40 hover:bg-muted/40">
              <td class="py-2.5 px-3 font-semibold text-foreground">{r.nama_kapal}</td>
              <td class={TD}>{r.kegiatan}</td>
              <td class={TD}>{r.truk}</td>
              <td class={TD}>{r.ritase}</td>
              <td class={TD}>{ton(r.tonase)}</td>
              <td class={TD}>{rupiah(r.rekanan)}</td>
              <td class={TD}>{rupiah(r.sangu_supir)}</td>
              <td class={TD}>{rupiah(r.terpal)}</td>
              <td class={TD}>{rupiah(r.operasional)}</td>
              <td class={TD}>{rupiah(r.paguyuban)}</td>
              <td class={TD}>{rupiah(r.telly)}</td>
              <td class="{TD} font-semibold text-foreground">{rupiah(r.total)}</td>
            </tr>
          {:else}
            <tr><td colspan="12" class="py-10 text-center text-muted-foreground">Belum ada kegiatan kapal di {namaBulan}.</td></tr>
          {/each}
        </tbody>
        {#if data.ringkas.length}
          <tfoot>
            <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
              <td class="py-2.5 px-3" colspan="5">TOTAL</td>
              {#each KOLOM as k (k)}<td class={TD}>{rupiah(jumlah[k])}</td>{/each}
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>
    <p class="text-[12px] text-muted-foreground">Beban rekanan = tonase × ongkos angkut, dibayarkan ke pemilik truk. Laba rugi resmi ada di Laporan P&amp;L.</p>
  </section>

  <section class="space-y-2">
    <h2 class="text-[14px] font-semibold text-foreground">Rincian per kegiatan</h2>
    <div class="bg-card border border-border rounded-lg overflow-x-auto">
      <table class="w-full min-w-[1000px] text-[13px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="{TH} text-left">Kapal</th><th class="{TH} text-left">Rute</th><th class="{TH} text-right">Trips</th><th class="{TH} text-right">Tonnase</th>
            <th class="{TH} text-right">Sangu Supir</th><th class="{TH} text-right">Terpal</th><th class="{TH} text-right">Operasional</th><th class="{TH} text-right">Total</th>
            <th class="{TH} text-left">Telly</th><th class="{TH} text-left">Tgl Kegiatan</th>
          </tr>
        </thead>
        <tbody>
          {#each data.kegiatan as k (k.id)}
            <tr class="border-b border-border/40 hover:bg-muted/40">
              <td class="py-2.5 px-3 font-semibold text-foreground">{k.nama_kapal}</td>
              <td class="py-2.5 px-3">{k.rute ?? '-'}</td>
              <td class={TD}>{k.trips}</td>
              <td class={TD}>{ton(k.tonase)}</td>
              <td class={TD}>{rupiah(k.sangu_supir)}</td>
              <td class={TD}>{rupiah(k.terpal)}</td>
              <td class={TD}>{rupiah(k.operasional)}</td>
              <td class="{TD} font-semibold text-foreground">{rupiah(k.total)}</td>
              <td class="py-2.5 px-3">{k.telly ?? '—'}</td>
              <td class="py-2.5 px-3 num whitespace-nowrap">{rentangTanggal(k.tanggal_kegiatan, k.tanggal_selesai)}</td>
            </tr>
          {:else}
            <tr><td colspan="10" class="py-8 text-center text-muted-foreground">—</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</div>
