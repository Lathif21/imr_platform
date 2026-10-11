<script lang="ts">
  import Banknote from 'lucide-svelte/icons/banknote';
  import BookOpen from 'lucide-svelte/icons/book-open';
  import ChartColumn from 'lucide-svelte/icons/chart-column';
  import ClipboardList from 'lucide-svelte/icons/clipboard-list';
  import HandHeart from 'lucide-svelte/icons/hand-heart';
  import Landmark from 'lucide-svelte/icons/landmark';
  import Receipt from 'lucide-svelte/icons/receipt';
  import Truck from 'lucide-svelte/icons/truck';
  import Users from 'lucide-svelte/icons/users';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN } from '$lib/operasional/kegiatan';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const q = $derived(
    `entitas=${encodeURIComponent(data.opEntity?.code ?? '')}&bulan=${data.periode.bulan}&tahun=${data.periode.tahun}`
  );

  const laporan = [
    { href: 'laporan/kumpulan', icon: BookOpen, title: 'Kumpulan Laporan Operasional & Laba Rugi', desc: 'Rincian operasional per kapal (invoice lunas) dan laba rugi operasional yang dapat diedit lalu dicetak.' },
    { href: 'pendapatan', icon: Landmark, title: 'Laporan Pendapatan Bulanan', desc: 'Rekap income penagihan Wilmar: party KG, PPh 0,5% / 2%, net tagihan, dan status pembayaran.' },
    { href: 'laporan/partner', icon: Truck, title: 'Laporan Partner', desc: 'Pembayaran ke pemilik kendaraan: beban rekanan, saku supir, terpal, dan jumlah bersih per pemilik.' },
    { href: 'laporan/gaji', icon: Banknote, title: 'Laporan Gaji Karyawan', desc: 'Honor telly per kegiatan dan gaji admin bulanan, lengkap dengan PPh, gaji bersih, dan slip gaji.' },
    { href: 'laporan/paguyuban', icon: HandHeart, title: 'Laporan Paguyuban', desc: 'Iuran paguyuban per kelompok kapal: tonase × tarif.' },
    { href: 'laporan/operasional', icon: ChartColumn, title: 'Laporan Operasional', desc: 'Rekap per kapal dan rincian biaya setiap kegiatan.' },
    { href: 'laporan/keuangan', icon: ClipboardList, title: 'Laporan Keuangan', desc: 'Rincian truk dan pengeluaran bulanan. Laba rugi resmi dihitung di Laporan P&L, bukan di sini.' },
    { href: 'pengeluaran', icon: Receipt, title: 'Laporan Pengeluaran', desc: 'Daftar dan cetak pengeluaran bulanan.' },
    { href: 'laporan/karyawan', icon: Users, title: 'Laporan Catatan Karyawan', desc: 'Rekam jejak keaktifan, riwayat SP1–SP3, dan catatan karyawan.' }
  ];
</script>

<svelte:head><title>Laporan · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-[15px] font-semibold text-foreground">Laporan</h1>
      <p class="text-[12px] text-muted-foreground mt-0.5">
        Laporan operasional · {NAMA_BULAN[data.periode.bulan - 1]} {data.periode.tahun}
      </p>
    </div>
    <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
  </div>

  <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
    {#each laporan as l (l.href)}
      <a href="/operasional/{l.href}?{q}" class="group bg-card border border-border rounded-lg p-4 hover:border-primary/50 hover:bg-muted/30 transition-colors">
        <div class="flex items-center gap-2 text-[13px] font-semibold text-foreground group-hover:text-primary">
          <l.icon size={15} class="text-muted-foreground group-hover:text-primary" />
          {l.title}
        </div>
        <p class="text-[12px] text-muted-foreground mt-1.5 leading-relaxed">{l.desc}</p>
      </a>
    {/each}
  </div>
</div>
