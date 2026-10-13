<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Printer from 'lucide-svelte/icons/printer';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import { enhance } from '$app/forms';
  import { withFeedback } from '$lib/form-feedback';
  import UnduhExcel from '$lib/operasional/UnduhExcel.svelte';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, ton } from '$lib/operasional/kegiatan';
  import { judulKapal } from '$lib/operasional/laporan-kapal';
  import { BTN_SOFT, rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const q = $derived(`entitas=${encodeURIComponent(data.opEntity?.code ?? '')}&bulan=${data.periode.bulan}&tahun=${data.periode.tahun}`);
  const namaBulan = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`);
  const jumlah = $derived(
    data.laporan.reduce(
      (a, l) => ({
        tonase: a.tonase + l.jumlahInvoice.tonase,
        tagihan: a.tagihan + l.jumlahInvoice.tagihan,
        pencairan: a.pencairan + l.jumlahInvoice.pencairan,
        biaya: a.biaya + l.biaya.total,
        net: a.net + l.net_pendapatan
      }),
      { tonase: 0, tagihan: 0, pencairan: 0, biaya: 0, net: 0 }
    )
  );

  let menyimpan = $state<number | null>(null);
  const simpanVoyage = (kapalId: number) =>
    withFeedback({ failTitle: 'Voyage gagal disimpan', onPending: (p) => (menyimpan = p ? kapalId : null) });

  const TH = 'font-semibold py-2.5 px-3 whitespace-nowrap';
  const TD = 'py-2.5 px-3 text-right num whitespace-nowrap';
</script>

<svelte:head><title>Laporan per Kapal · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <div>
      <a href="/operasional/laporan?{q}" class="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft size={13} /> Laporan</a>
      <h1 class="text-[17px] font-semibold text-foreground mt-1">Laporan per Kapal</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">Rincian kegiatan operasional, rekanan, dan pembayaran rekanan setiap kapal · {namaBulan}</p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
      <UnduhExcel laporan="kapal" />
      {#if data.laporan.length}
        <a href="/cetak/operasional/kapal?{q}" target="_blank" rel="noopener" class={BTN_SOFT}><Printer size={14} /> Cetak semua kapal</a>
      {/if}
    </div>
  </div>

  {#if data.tanpaKegiatan.length}
    <div class="flex gap-2 items-start rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-[13px] text-foreground">
      <TriangleAlert size={14} class="mt-0.5 shrink-0 text-warning" />
      <div>
        {data.tanpaKegiatan.length} invoice bulan ini tidak tertaut ke kegiatan kapal, jadi tidak masuk laporan kapal mana pun:
        {data.tanpaKegiatan.map((i) => `${i.no_invoice ?? '(tanpa nomor)'} — ${i.kegiatan}`).join('; ')}.
        Invoice yang dibuat lewat "Generate dari Kegiatan" selalu tertaut.
      </div>
    </div>
  {/if}

  <div class="bg-card border border-border rounded-lg overflow-x-auto">
    <table class="w-full min-w-[1080px] text-[13px]">
      <thead>
        <tr class="text-muted-foreground border-b border-border">
          <th class="{TH} text-left">Kapal</th>
          <th class="{TH} text-left">Voyage</th>
          <th class="{TH} text-right">Invoice</th>
          <th class="{TH} text-right">Tonase (MT)</th>
          <th class="{TH} text-right">Tagihan Wilmar</th>
          <th class="{TH} text-right">Pencairan</th>
          <th class="{TH} text-right">Total Biaya</th>
          <th class="{TH} text-right">Net Pendapatan</th>
          <th class="{TH} text-right">Rekanan</th>
          <th class="{TH} text-right">Cetak</th>
        </tr>
      </thead>
      <tbody>
        {#each data.laporan as l (l.kapal_id)}
          <tr class="border-b border-border/40 hover:bg-muted/40 align-top">
            <td class="py-2.5 px-3">
              <div class="font-semibold text-foreground">{judulKapal(l)}</div>
              {#each l.catatan as c, i (i)}
                <div class="flex gap-1 items-start text-[12px] text-warning mt-1"><TriangleAlert size={12} class="mt-0.5 shrink-0" /> {c}</div>
              {/each}
            </td>
            <td class="py-2 px-3">
              {#if data.canWrite}
                <form method="POST" action="?/voyage" use:enhance={simpanVoyage(l.kapal_id)} class="flex items-center gap-1">
                  <input type="hidden" name="entity_id" value={data.opEntity?.id} />
                  <input type="hidden" name="kapal_id" value={l.kapal_id} />
                  <input type="hidden" name="bulan" value={data.periode.bulan} />
                  <input type="hidden" name="tahun" value={data.periode.tahun} />
                  <input
                    name="voyage"
                    value={l.voyage ?? ''}
                    maxlength="50"
                    placeholder="cth. 9"
                    aria-label="Voyage {l.nama_kapal}"
                    class="w-[72px] h-[28px] px-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-subtle focus:outline-none focus:border-primary"
                  />
                  <button type="submit" disabled={menyimpan === l.kapal_id} class="h-[28px] px-2 rounded-md border border-border text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-60">
                    {menyimpan === l.kapal_id ? '…' : 'Simpan'}
                  </button>
                </form>
              {:else}
                {l.voyage ?? '—'}
              {/if}
            </td>
            <td class={TD}>{l.invoice.length}</td>
            <td class={TD}>{ton(l.jumlahInvoice.tonase)}</td>
            <td class={TD}>{rupiah(l.jumlahInvoice.tagihan)}</td>
            <td class={TD}>{rupiah(l.jumlahInvoice.pencairan)}</td>
            <td class={TD}>{rupiah(l.biaya.total)}</td>
            <td class="{TD} font-semibold {l.net_pendapatan < 0 ? 'text-destructive' : 'text-foreground'}">{rupiah(l.net_pendapatan)}</td>
            <td class={TD}>{l.pembayaran.length}</td>
            <td class="py-2 px-3 text-right">
              <a href="/cetak/operasional/kapal?{q}&kapal={l.kapal_id}" target="_blank" rel="noopener" class="{BTN_SOFT} h-[28px] px-2.5 text-[12px]" title="Tampilan cetak — pilih &quot;Simpan sebagai PDF&quot; di dialog cetak">
                <Printer size={12} /> PDF
              </a>
            </td>
          </tr>
        {:else}
          <tr><td colspan="10" class="py-10 text-center text-muted-foreground">Belum ada kegiatan kapal di {namaBulan}.</td></tr>
        {/each}
      </tbody>
      {#if data.laporan.length}
        <tfoot>
          <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
            <td class="py-2.5 px-3" colspan="3">TOTAL</td>
            <td class={TD}>{ton(jumlah.tonase)}</td>
            <td class={TD}>{rupiah(jumlah.tagihan)}</td>
            <td class={TD}>{rupiah(jumlah.pencairan)}</td>
            <td class={TD}>{rupiah(jumlah.biaya)}</td>
            <td class={TD}>{rupiah(jumlah.net)}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      {/if}
    </table>
  </div>
  <p class="text-[12px] text-muted-foreground">
    Pencairan = net tagihan invoice. Total biaya = operasional telly + PBM (tidak tercatat, Rp 0) + rekanan (tonase × ongkos angkut).
    Net pembayaran rekanan = bruto − uang saku − terpal − pajak 0,5%. Rekening rekanan diisi di Master Pemilik.
  </p>
</div>
