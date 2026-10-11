<script lang="ts">
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import HandCoins from 'lucide-svelte/icons/hand-coins';
  import Landmark from 'lucide-svelte/icons/landmark';
  import Receipt from 'lucide-svelte/icons/receipt';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, ton } from '$lib/operasional/kegiatan';
  import { rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const q = $derived(`entitas=${encodeURIComponent(data.opEntity?.code ?? '')}&bulan=${data.periode.bulan}&tahun=${data.periode.tahun}`);
  const entityQuery = $derived(`entitas=${encodeURIComponent(data.opEntity?.code ?? '')}`);
  const namaBulan = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`);
  const d = $derived(data.dasbor);

  const STATUS: Record<string, string> = {
    Approved: 'bg-positive/10 text-positive',
    Rejected: 'bg-destructive/10 text-destructive',
    Pending: 'bg-warning/10 text-warning'
  };
  const KARTU = 'bg-card border border-border rounded-lg p-4';
</script>

<svelte:head><title>Dasbor · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-[15px] font-semibold text-foreground">Dasbor Operasional</h1>
      <p class="text-[12px] text-muted-foreground mt-0.5">{data.opEntity?.legal_name} · {namaBulan}</p>
    </div>
    <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
  </div>

  {#if d}
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      {#each [
        { label: 'Kegiatan kapal', nilai: String(d.ringkas.kegiatan), href: `/operasional/kegiatan?${q}` },
        { label: 'Truk', nilai: String(d.ringkas.truk), href: `/operasional/general?${q}` },
        { label: 'Ritase', nilai: String(d.ringkas.ritase), href: `/operasional/kegiatan?${q}` },
        { label: 'Tonase', nilai: `${ton(d.ringkas.tonase)} MT`, href: `/operasional/kegiatan?${q}` }
      ] as k (k.label)}
        <a href={k.href} class="{KARTU} hover:border-primary/50">
          <div class="text-[11px] text-muted-foreground">{k.label}</div>
          <div class="text-[18px] font-semibold text-foreground num mt-1">{k.nilai}</div>
        </a>
      {/each}
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-3 items-start">
      <!-- 1. Pendapatan -->
      <section class={KARTU}>
        <div class="flex items-center justify-between">
          <h2 class="text-[13px] font-semibold text-foreground inline-flex items-center gap-2"><Landmark size={14} class="text-muted-foreground" /> Pendapatan</h2>
          <a href="/operasional/pendapatan?{q}" class="text-[11px] text-primary hover:underline inline-flex items-center gap-1">Laporan Pendapatan <ArrowRight size={11} /></a>
        </div>
        <div class="text-[22px] font-semibold text-foreground num mt-3">{rupiah(d.pendapatan.semua.total)}</div>
        <div class="text-[11px] text-muted-foreground">Tagihan bruto · {d.pendapatan.semua.jumlah} invoice · {ton(d.pendapatan.semua.party_kg)} KG</div>
        <dl class="mt-3 space-y-1.5 text-[12px]">
          <div class="flex justify-between"><dt class="text-muted-foreground">Pajak</dt><dd class="num text-destructive">− {rupiah(d.pendapatan.semua.pajak)}</dd></div>
          <div class="flex justify-between font-semibold text-foreground border-t border-border pt-1.5"><dt>Net tagihan</dt><dd class="num">{rupiah(d.pendapatan.semua.net_tagihan)}</dd></div>
          <div class="flex justify-between"><dt class="text-muted-foreground">Sudah dibayar · {d.pendapatan.sudah.jumlah}</dt><dd class="num text-positive">{rupiah(d.pendapatan.sudah.net_tagihan)}</dd></div>
          <div class="flex justify-between"><dt class="text-muted-foreground">Belum dibayar · {d.pendapatan.belum.jumlah}</dt><dd class="num text-warning">{rupiah(d.pendapatan.belum.net_tagihan)}</dd></div>
        </dl>
      </section>

      <!-- 2. Pengeluaran kotor -->
      <section class={KARTU}>
        <div class="flex items-center justify-between">
          <h2 class="text-[13px] font-semibold text-foreground inline-flex items-center gap-2"><Receipt size={14} class="text-muted-foreground" /> Pengeluaran Kotor</h2>
          <a href="/operasional/laporan/operasional?{q}" class="text-[11px] text-primary hover:underline inline-flex items-center gap-1">Laporan Operasional <ArrowRight size={11} /></a>
        </div>
        <div class="text-[22px] font-semibold text-foreground num mt-3">{rupiah(d.totalPengeluaran)}</div>
        <div class="text-[11px] text-muted-foreground">Semua biaya operasional bulan ini</div>
        <dl class="mt-3 space-y-1.5 text-[12px]">
          {#each d.pengeluaran as p (p.label)}
            <div class="flex justify-between gap-2">
              <dt><a href="/operasional/{p.href}?{q}" class="text-muted-foreground hover:text-foreground">{p.label}</a></dt>
              <dd class="num">{rupiah(p.nilai)}</dd>
            </div>
          {/each}
        </dl>
      </section>

      <!-- 3. Pencairan -->
      <section class={KARTU}>
        <div class="flex items-center justify-between">
          <h2 class="text-[13px] font-semibold text-foreground inline-flex items-center gap-2"><HandCoins size={14} class="text-muted-foreground" /> Pencairan</h2>
          <a href="/operasional/pencairan?{q}" class="text-[11px] text-primary hover:underline inline-flex items-center gap-1">Pencairan <ArrowRight size={11} /></a>
        </div>
        <div class="text-[22px] font-semibold text-foreground num mt-3">{rupiah(d.pencairan.nominal)}</div>
        <div class="text-[11px] text-muted-foreground">
          {d.pencairan.jumlah} invoice · disetujui {d.pencairan.approved} · pending {d.pencairan.pending}{d.pencairan.rejected ? ` · ditolak ${d.pencairan.rejected}` : ''}
        </div>
        <ul class="mt-3 space-y-1.5 text-[12px]">
          {#each d.pencairan.daftar as c (c.id)}
            <li class="flex items-center justify-between gap-2">
              <span class="truncate"><span class="num text-foreground">{c.nomor_invoice}</span> <span class="text-muted-foreground">· {c.kapal}</span></span>
              <span class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium {STATUS[c.status] ?? ''}">{c.status}</span>
            </li>
          {:else}
            <li class="text-muted-foreground">Belum ada invoice pencairan bulan ini.</li>
          {/each}
        </ul>
      </section>
    </div>

    <section class="{KARTU} flex items-center justify-between gap-3 flex-wrap">
      <div>
        <div class="text-[11px] text-muted-foreground">Selisih perkiraan: tagihan bruto − pajak − pengeluaran kotor</div>
        <div class="text-[20px] font-semibold num mt-0.5 {d.selisih < 0 ? 'text-destructive' : 'text-positive'}">{rupiah(d.selisih)}</div>
      </div>
      <p class="text-[11px] text-muted-foreground max-w-[460px] leading-relaxed">
        Angka cepat untuk memantau bulan berjalan. Laba rugi resmi entitas ada di Laporan P&amp;L; laba rugi operasional
        versi lapangan ada di <a href="/operasional/laporan/kumpulan?{q}" class="text-primary hover:underline">Kumpulan Laporan</a>.
      </p>
    </section>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
      <section class={KARTU}>
        <h2 class="text-[13px] font-semibold text-foreground mb-2">Kapal teratas (tonase)</h2>
        {#each d.kapalTeratas as k (k.nama)}
          <div class="flex justify-between text-[12px] py-1 border-b border-border/40 last:border-b-0">
            <span class="truncate">{k.nama}</span><span class="num text-muted-foreground">{ton(k.tonase)} MT · {rupiah(k.biaya)}</span>
          </div>
        {:else}<p class="text-[12px] text-muted-foreground">—</p>{/each}
      </section>
      <section class={KARTU}>
        <h2 class="text-[13px] font-semibold text-foreground mb-2">Partner teratas (dibayar)</h2>
        {#each d.partnerTeratas as p (p.nama)}
          <div class="flex justify-between text-[12px] py-1 border-b border-border/40 last:border-b-0">
            <span class="truncate">{p.nama} <span class="text-muted-foreground">· {p.kendaraan} truk</span></span><span class="num">{rupiah(p.dibayar)}</span>
          </div>
        {:else}<p class="text-[12px] text-muted-foreground">—</p>{/each}
      </section>
      <section class={KARTU}>
        <h2 class="text-[13px] font-semibold text-foreground mb-2">Telly teratas (honor bersih)</h2>
        {#each d.tellyTeratas as t (t.nama)}
          <div class="flex justify-between text-[12px] py-1 border-b border-border/40 last:border-b-0">
            <span class="truncate">{t.nama} <span class="text-muted-foreground">· {t.aktivitas} kegiatan</span></span><span class="num">{rupiah(t.bersih)}</span>
          </div>
        {:else}<p class="text-[12px] text-muted-foreground">—</p>{/each}
      </section>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      {#each [
        { label: 'Pemilik', n: d.master.pemilik, href: 'pemilik' },
        { label: 'Kendaraan', n: d.master.kendaraan, href: 'kendaraan' },
        { label: 'Kapal', n: d.master.kapal, href: 'kapal' },
        { label: 'Karyawan', n: d.master.karyawan, href: 'karyawan' }
      ] as m (m.label)}
        <a href="/operasional/{m.href}?{entityQuery}" class="{KARTU} py-3 flex items-center justify-between hover:border-primary/50">
          <span class="text-[12px] text-muted-foreground">{m.label}</span><span class="text-[15px] font-semibold num text-foreground">{m.n}</span>
        </a>
      {/each}
    </div>
  {/if}
</div>
