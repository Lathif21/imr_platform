<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Plus from 'lucide-svelte/icons/plus';
  import Printer from 'lucide-svelte/icons/printer';
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { withFeedback } from '$lib/form-feedback';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN } from '$lib/operasional/kegiatan';
  import { pendapatanKartu, ringkasLabaRugi, type KartuKapal, type Pengeluaran } from '$lib/operasional/kumpulan';
  import { BTN_ICON_DANGER, BTN_PRIMARY, BTN_SOFT, TEXTAREA, rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const salin = () => ({
    cards: (data.kumpulan?.cards ?? []).map((c) => ({ ...c })),
    keluar: { ...(data.kumpulan?.pengeluaran ?? { gaji_karyawan: 0, sewa_kantor: 0, pph_sewa_kantor: 0, atensi_jalan: 0, beban_kantor: 0 }) },
    notes: data.kumpulan?.notes ?? ''
  });
  let isi = $state(untrack(salin));
  let saving = $state(false);

  const lr = $derived(ringkasLabaRugi(isi.cards, isi.keluar));
  const q = $derived(`entitas=${encodeURIComponent(data.opEntity?.code ?? '')}&bulan=${data.periode.bulan}&tahun=${data.periode.tahun}`);
  const namaBulan = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`);

  const fmt = (n: number) => (n ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n) : '');
  const baca = (v: string) => Number(v.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0;

  const RUPIAH_KARTU: { key: keyof KartuKapal; label: string }[] = [
    { key: 'tagihan', label: 'Tagihan' },
    { key: 'pajak', label: 'Pajak' },
    { key: 'rekanan', label: 'Rekanan' },
    { key: 'ongkos_pbm', label: 'Ongkos PBM' },
    { key: 'terpal_50', label: 'Terpal (50%)' },
    { key: 'operasional', label: 'Operasional' }
  ];
  const KELUAR: { key: keyof Pengeluaran; label: string }[] = [
    { key: 'gaji_karyawan', label: 'Gaji Karyawan' },
    { key: 'sewa_kantor', label: 'Sewa Kantor' },
    { key: 'pph_sewa_kantor', label: 'PPh Sewa Kantor' },
    { key: 'atensi_jalan', label: 'Atensi Jalan' },
    { key: 'beban_kantor', label: 'Beban Kantor, ATK, dll' }
  ];

  const kartuBaru = (): KartuKapal => ({ kegiatan: '', telly: '', muatan_mt: 0, ritase: 0, tagihan: 0, pajak: 0, rekanan: 0, ongkos_pbm: 0, terpal_50: 0, operasional: 0 });

  const simpan = withFeedback({ failTitle: 'Kumpulan laporan gagal disimpan', onSuccess: () => (isi = salin()), onPending: (p) => (saving = p) });
  const reset = withFeedback({
    failTitle: 'Kumpulan laporan gagal direset',
    confirm: () => ({
      title: 'Reset ke hitungan otomatis?',
      message: `Versi tersimpan ${namaBulan} dihapus dan angka dihitung ulang dari data operasional.`,
      consequence: 'Semua perubahan manual pada kartu kapal, pengeluaran, dan catatan bulan ini hilang.',
      confirmLabel: 'Ya, reset',
      tone: 'danger'
    }),
    onSuccess: () => (isi = salin()),
    onPending: (p) => (saving = p)
  });

  const IN = 'h-[28px] w-full px-2 bg-background border border-border rounded-md text-[13px] text-foreground focus:outline-none focus:border-primary';
</script>

<svelte:head><title>Kumpulan Laporan · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <div>
      <a href="/operasional/laporan?{q}" class="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft size={13} /> Laporan</a>
      <h1 class="text-[17px] font-semibold text-foreground mt-1">Kumpulan Laporan Operasional &amp; Laba Rugi</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">
        {namaBulan} ·
        {#if data.kumpulan?.disimpan}
          versi tersimpan manual, {new Date(data.kumpulan.disimpan).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' })}
        {:else}
          dihitung otomatis dari invoice lunas
        {/if}
      </p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
      <a href="/cetak/operasional/kumpulan?{q}" target="_blank" rel="noopener" class={BTN_SOFT}><Printer size={14} /> Cetak</a>
      {#if data.canWrite && data.kumpulan?.disimpan}
        <form method="POST" action="?/reset" use:enhance={reset}>
          <input type="hidden" name="entity_id" value={data.opEntity?.id} />
          <input type="hidden" name="bulan" value={data.periode.bulan} />
          <input type="hidden" name="tahun" value={data.periode.tahun} />
          <button type="submit" disabled={saving} class={BTN_SOFT}><RotateCcw size={14} /> Reset</button>
        </form>
      {/if}
    </div>
  </div>

  {#if data.kumpulan?.tanpaKegiatan.length}
    <div class="flex gap-2 items-start rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-[13px] text-foreground">
      <TriangleAlert size={14} class="mt-0.5 shrink-0 text-warning" />
      <p>
        {data.kumpulan.tanpaKegiatan.length} invoice lunas tidak tertaut ke kegiatan kapal ({data.kumpulan.tanpaKegiatan.join(', ')}), sehingga
        rekanan, terpal, operasional, dan telly-nya terbaca 0. Isi manual bila perlu, lalu simpan.
      </p>
    </div>
  {/if}

  <fieldset disabled={!data.canWrite} class="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 items-start">
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-[14px] font-semibold text-foreground">Rincian Kegiatan Operasional</h2>
        {#if data.canWrite}
          <button type="button" onclick={() => (isi.cards = [...isi.cards, kartuBaru()])} class="{BTN_SOFT} h-[28px] px-3 text-[13px]"><Plus size={13} /> Tambah kartu</button>
        {/if}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        {#each isi.cards as c, i (i)}
          <div class="bg-card border border-border rounded-lg p-3 space-y-1.5 text-[13px]">
            <div class="flex gap-1.5">
              <input bind:value={c.kegiatan} placeholder="NAMA KAPAL / KEGIATAN" aria-label="Kapal kartu {i + 1}" class="{IN} font-semibold uppercase" />
              {#if data.canWrite}
                <button type="button" onclick={() => (isi.cards = isi.cards.filter((_, j) => j !== i))} class={BTN_ICON_DANGER} aria-label="Hapus kartu {c.kegiatan}"><Trash2 size={14} /></button>
              {/if}
            </div>
            <div class="grid grid-cols-[96px_1fr] items-center gap-x-2 gap-y-1.5">
              <span class="text-muted-foreground">Telly</span>
              <input bind:value={c.telly} aria-label="Telly" class={IN} />
              <span class="text-muted-foreground">Muatan (MT)</span>
              <input value={fmt(c.muatan_mt)} onchange={(e) => (c.muatan_mt = baca(e.currentTarget.value))} inputmode="decimal" aria-label="Muatan" class="{IN} text-right num" />
              <span class="text-muted-foreground">Ritase</span>
              <input value={fmt(c.ritase)} onchange={(e) => (c.ritase = Math.round(baca(e.currentTarget.value)))} inputmode="numeric" aria-label="Ritase" class="{IN} text-right num" />
              {#each RUPIAH_KARTU as f (f.key)}
                <span class="text-muted-foreground">{f.label}</span>
                <input value={fmt(c[f.key] as number)} onchange={(e) => ((c[f.key] as number) = baca(e.currentTarget.value))} inputmode="numeric" aria-label={f.label} class="{IN} text-right num" />
              {/each}
              <span class="font-semibold text-foreground border-t border-border pt-1.5">Pendapatan</span>
              <span class="text-right num font-semibold text-foreground border-t border-border pt-1.5">{rupiah(pendapatanKartu(c))}</span>
            </div>
          </div>
        {:else}
          <p class="md:col-span-2 bg-card border border-border rounded-lg py-8 text-center text-[13px] text-muted-foreground">
            Belum ada invoice lunas untuk {namaBulan}. Kumpulan hanya memuat invoice yang sudah dibayar.
          </p>
        {/each}
      </div>
    </section>

    <section class="bg-card border border-border rounded-lg p-4 text-[13px] space-y-1.5">
      <h2 class="text-[14px] font-semibold text-foreground text-center">Laporan Laba Rugi</h2>
      <p class="text-center text-muted-foreground">{data.opEntity?.legal_name} · {namaBulan}</p>
      <div class="pt-2 font-semibold text-foreground">PENDAPATAN</div>
      {#each [['Tagihan Wilmar', lr.tagihan_wilmar], ['Pajak (0,5%)', lr.pajak], ['Rekanan', lr.rekanan], ['PBM', lr.pbm], ['Terpal (50%)', lr.terpal_50], ['Operasional Telly', lr.operasional_telly]] as [label, v] (label)}
        <div class="flex justify-between pl-3"><span class="text-muted-foreground">{label}</span><span class="num">{rupiah(v as number)}</span></div>
      {/each}
      <div class="flex justify-between font-semibold text-foreground border-t border-border pt-1.5"><span>Pendapatan Operasional</span><span class="num">{rupiah(lr.pendapatan_operasional)}</span></div>
      <div class="pt-3 font-semibold text-foreground">PENGELUARAN</div>
      {#each KELUAR as f (f.key)}
        <label class="flex justify-between items-center gap-3 pl-3">
          <span class="text-muted-foreground">{f.label}</span>
          <input value={fmt(isi.keluar[f.key])} onchange={(e) => (isi.keluar[f.key] = baca(e.currentTarget.value))} inputmode="numeric" class="{IN} w-[150px] text-right num" />
        </label>
      {/each}
      <div class="flex justify-between font-semibold text-destructive border-t border-border pt-1.5"><span>Pengeluaran Total</span><span class="num">{rupiah(lr.total_pengeluaran)}</span></div>
      <div class="flex justify-between font-semibold text-[15px] pt-2 {lr.pendapatan_bersih < 0 ? 'text-destructive' : 'text-positive'}">
        <span>Pendapatan Bersih</span><span class="num">{rupiah(lr.pendapatan_bersih)}</span>
      </div>
      <label class="block pt-3">
        <span class="text-[12px] text-muted-foreground">Catatan</span>
        <textarea bind:value={isi.notes} class={TEXTAREA}></textarea>
      </label>
      <p class="text-[12px] text-muted-foreground leading-relaxed pt-1">
        Laporan operasional internal. Laba rugi resmi entitas dihitung di Laporan P&amp;L portal keuangan.
      </p>
    </section>
  </fieldset>

  {#if data.canWrite}
    <form method="POST" action="?/simpan" use:enhance={simpan} class="flex justify-end">
      <input type="hidden" name="entity_id" value={data.opEntity?.id} />
      <input type="hidden" name="bulan" value={data.periode.bulan} />
      <input type="hidden" name="tahun" value={data.periode.tahun} />
      <input type="hidden" name="cards" value={JSON.stringify(isi.cards)} />
      <input type="hidden" name="pengeluaran" value={JSON.stringify(isi.keluar)} />
      <input type="hidden" name="notes" value={isi.notes} />
      <button type="submit" disabled={saving} class={BTN_PRIMARY}>{saving ? 'Menyimpan…' : 'Simpan Kumpulan Laporan'}</button>
    </form>
  {/if}
</div>
