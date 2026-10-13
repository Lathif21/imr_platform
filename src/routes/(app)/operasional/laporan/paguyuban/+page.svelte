<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, rentangTanggal, ton } from '$lib/operasional/kegiatan';
  import { rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const q = $derived(`entitas=${encodeURIComponent(data.opEntity?.code ?? '')}&bulan=${data.periode.bulan}&tahun=${data.periode.tahun}`);
  const namaBulan = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`);
  const grupDipilih = $derived(data.grup.find((g) => g.kunci === data.dipilih) ?? null);
  const total = $derived(data.grup.reduce((a, g) => ({ t: a.t + g.transaksi, ton: a.ton + g.tonase, rp: a.rp + g.total }), { t: 0, ton: 0, rp: 0 }));

  const TH = 'font-semibold py-2.5 px-3 whitespace-nowrap';
  const TD = 'py-2.5 px-3 text-right num whitespace-nowrap';
</script>

<svelte:head><title>Laporan Paguyuban · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <div>
      <a href={data.dipilih ? `?${q}` : `/operasional/laporan?${q}`} class="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft size={13} /> {data.dipilih ? 'Rekap per paguyuban' : 'Laporan'}
      </a>
      <h1 class="text-[17px] font-semibold text-foreground mt-1">Laporan Paguyuban{grupDipilih ? ` · ${grupDipilih.nama}` : ''}</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">Iuran paguyuban berdasarkan tonase · {namaBulan}</p>
    </div>
    <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
  </div>

  {#if !data.dipilih}
    <div class="bg-card border border-border rounded-lg overflow-x-auto">
      <table class="w-full min-w-[700px] text-[13px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="{TH} text-left">Paguyuban</th>
            <th class="{TH} text-right">Jumlah Kapal</th>
            <th class="{TH} text-right">Transaksi</th>
            <th class="{TH} text-right">Tonase (MT)</th>
            <th class="{TH} text-right">Total Dibayar</th>
            <th class="{TH} text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each data.grup as g (g.kunci)}
            <tr class="border-b border-border/40 hover:bg-muted/40">
              <td class="py-2.5 px-3 font-semibold text-foreground">{g.nama}</td>
              <td class={TD}>{g.kapal}</td>
              <td class={TD}>{g.transaksi}</td>
              <td class={TD}>{ton(g.tonase)}</td>
              <td class="{TD} font-semibold text-foreground">{rupiah(g.total)}</td>
              <td class="py-2 px-3 text-right"><a href="?{q}&paguyuban={encodeURIComponent(g.kunci)}" class="text-primary hover:underline">Rincian</a></td>
            </tr>
          {:else}
            <tr><td colspan="6" class="py-10 text-center text-muted-foreground">Belum ada iuran paguyuban di {namaBulan}.</td></tr>
          {/each}
        </tbody>
        {#if data.grup.length}
          <tfoot>
            <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
              <td class="py-2.5 px-3" colspan="2">TOTAL</td>
              <td class={TD}>{total.t}</td>
              <td class={TD}>{ton(total.ton)}</td>
              <td class={TD}>{rupiah(total.rp)}</td>
              <td></td>
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>
    <p class="text-[12px] text-muted-foreground">
      Iuran dihitung otomatis saat rincian truk disimpan: tonase × tarif (Rp 500/ton bila belum disesuaikan).
      Kapal tanpa nama paguyuban dikelompokkan di "(Tanpa nama paguyuban)".
    </p>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">
      <div class="bg-card border border-border rounded-lg overflow-hidden">
        <div class="px-3 py-2.5 border-b border-border text-[14px] font-semibold text-foreground">Daftar Kapal Tergabung</div>
        <table class="w-full text-[13px]">
          <thead><tr class="text-muted-foreground border-b border-border"><th class="{TH} text-left">Nama Kapal</th><th class="{TH} text-right">Kapasitas</th><th class="{TH} text-right">Biaya</th></tr></thead>
          <tbody>
            {#each data.kapalGrup as k (k.nama_kapal)}
              <tr class="border-b border-border/40"><td class="py-2 px-3">{k.nama_kapal}</td><td class={TD}>{k.kapasitas_ton === null ? '—' : `${ton(k.kapasitas_ton)} T`}</td><td class={TD}>{rupiah(k.total)}</td></tr>
            {:else}
              <tr><td colspan="3" class="py-6 text-center text-muted-foreground">—</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="bg-card border border-border rounded-lg overflow-x-auto">
        <table class="w-full min-w-[600px] text-[13px]">
          <thead>
            <tr class="text-muted-foreground border-b border-border">
              <th class="{TH} text-left">Tanggal</th><th class="{TH} text-left">Kapal</th><th class="{TH} text-left">Kendaraan</th>
              <th class="{TH} text-right">Tonase</th><th class="{TH} text-right">Tarif</th><th class="{TH} text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {#each data.rincian as r, i (i)}
              <tr class="border-b border-border/40 hover:bg-muted/40">
                <td class="py-2.5 px-3 num">{rentangTanggal(r.tanggal, null)}</td>
                <td class="py-2.5 px-3">{r.kapal}</td>
                <td class="py-2.5 px-3 font-semibold text-foreground">{r.nopol}</td>
                <td class={TD}>{ton(r.tonase)}</td>
                <td class={TD}>{rupiah(r.tarif)}</td>
                <td class="{TD} font-semibold text-foreground">{rupiah(r.total)}</td>
              </tr>
            {:else}
              <tr><td colspan="6" class="py-10 text-center text-muted-foreground">Tidak ada iuran pada periode ini.</td></tr>
            {/each}
          </tbody>
          {#if data.rincian.length}
            <tfoot>
              <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
                <td class="py-2.5 px-3" colspan="3">TOTAL</td>
                <td class={TD}>{ton(data.rincian.reduce((s, r) => s + r.tonase, 0))}</td>
                <td></td>
                <td class={TD}>{rupiah(data.rincian.reduce((s, r) => s + r.total, 0))}</td>
              </tr>
            </tfoot>
          {/if}
        </table>
      </div>
    </div>
  {/if}
</div>
