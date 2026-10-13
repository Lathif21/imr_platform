<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, rentangTanggal } from '$lib/operasional/kegiatan';
  import { rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const q = $derived(`entitas=${encodeURIComponent(data.opEntity?.code ?? '')}&bulan=${data.periode.bulan}&tahun=${data.periode.tahun}`);
  const namaBulan = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`);
  const jTrx = $derived(data.transaksi.reduce((a, t) => ({ r: a.r + t.rekanan, b: a.b + t.biaya }), { r: 0, b: 0 }));
  const jKeluar = $derived(data.pengeluaran.reduce((s, p) => s + p.jumlah, 0));

  const TH = 'font-semibold py-2.5 px-3 whitespace-nowrap';
  const TD = 'py-2.5 px-3 text-right num whitespace-nowrap';
</script>

<svelte:head><title>Laporan Keuangan · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <div>
      <a href="/operasional/laporan?{q}" class="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft size={13} /> Laporan</a>
      <h1 class="text-[17px] font-semibold text-foreground mt-1">Laporan Keuangan</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">Rincian biaya bulanan · {namaBulan} · laba rugi resmi ada di Laporan P&amp;L</p>
    </div>
    <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
  </div>

  <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
    <section class="bg-card border border-border rounded-lg overflow-hidden">
      <div class="px-4 py-2.5 border-b border-border text-[14px] font-semibold text-foreground">Transaksi Operasional · {data.transaksi.length} truk</div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr class="text-muted-foreground border-b border-border">
              <th class="{TH} text-left">Tanggal</th><th class="{TH} text-left">Kapal / Nopol</th>
              <th class="{TH} text-right">Bagian Rekanan</th><th class="{TH} text-right">Biaya Lapangan</th>
            </tr>
          </thead>
          <tbody>
            {#each data.transaksi as t (t.id)}
              <tr class="border-b border-border/40">
                <td class="py-2.5 px-3 num">{rentangTanggal(t.tanggal, null)}</td>
                <td class="py-2.5 px-3">{t.kapal} <span class="text-muted-foreground">· {t.nopol}</span></td>
                <td class="{TD} font-semibold text-foreground">{rupiah(t.rekanan)}</td>
                <td class={TD}>{rupiah(t.biaya)}</td>
              </tr>
            {:else}
              <tr><td colspan="4" class="py-8 text-center text-muted-foreground">Belum ada transaksi operasional pada periode ini.</td></tr>
            {/each}
          </tbody>
          {#if data.transaksi.length}
            <tfoot>
              <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
                <td class="py-2.5 px-3" colspan="2">TOTAL</td><td class={TD}>{rupiah(jTrx.r)}</td><td class={TD}>{rupiah(jTrx.b)}</td>
              </tr>
            </tfoot>
          {/if}
        </table>
      </div>
    </section>

    <section class="bg-card border border-border rounded-lg overflow-hidden">
      <div class="px-4 py-2.5 border-b border-border text-[14px] font-semibold text-foreground">Pengeluaran Manual · {data.pengeluaran.length} data</div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr class="text-muted-foreground border-b border-border">
              <th class="{TH} text-left">Tanggal</th><th class="{TH} text-left">Jenis</th><th class="{TH} text-left">Penerima</th><th class="{TH} text-right">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {#each data.pengeluaran as p (p.id)}
              <tr class="border-b border-border/40">
                <td class="py-2.5 px-3 num">{rentangTanggal(p.tanggal, null)}</td>
                <td class="py-2.5 px-3"><div class="font-semibold text-foreground">{p.jenis}</div><div class="text-[12px] text-muted-foreground">{p.nama_kegiatan || '-'}</div></td>
                <td class="py-2.5 px-3">{p.penerima || '-'}</td>
                <td class="{TD} text-destructive">{rupiah(p.jumlah)}</td>
              </tr>
            {:else}
              <tr><td colspan="4" class="py-8 text-center text-muted-foreground">Belum ada pengeluaran manual pada periode ini.</td></tr>
            {/each}
          </tbody>
          {#if data.pengeluaran.length}
            <tfoot><tr class="border-t border-border bg-muted/40 font-semibold text-foreground"><td class="py-2.5 px-3" colspan="3">TOTAL</td><td class={TD}>{rupiah(jKeluar)}</td></tr></tfoot>
          {/if}
        </table>
      </div>
    </section>
  </div>
  <p class="text-[12px] text-muted-foreground">
    Bagian rekanan = tonase × ongkos angkut, dibayarkan ke pemilik truk. Biaya lapangan = saku + terpal + operasional + honor telly per truk + iuran paguyuban.
  </p>
</div>
