<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Printer from 'lucide-svelte/icons/printer';
  import Wallet from 'lucide-svelte/icons/wallet';
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { withFeedback } from '$lib/form-feedback';
  import { TARIF_PAJAK_REKANAN, bacaPersen, labelPersen, pajakRekanan } from '$lib/operasional/pajak';
  import UnduhExcel from '$lib/operasional/UnduhExcel.svelte';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, rentangTanggal, ton } from '$lib/operasional/kegiatan';
  import { BTN_SOFT, rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const q = $derived(`entitas=${encodeURIComponent(data.opEntity?.code ?? '')}&bulan=${data.periode.bulan}&tahun=${data.periode.tahun}`);
  const namaBulan = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`);
  type Ringkas = (typeof data.ringkas)[number];

  // What is typed in the rate fields, per owner, until it is saved. The
  // nominal follows the typing; nothing is stored but the rate.
  let ketik = $state<Record<number, string>>({});
  let menyimpan = $state<number | null>(null);
  const teksPersen = (r: Ringkas) => ketik[r.id] ?? r.persen_pajak.toLocaleString('id-ID', { maximumFractionDigits: 2 });
  /** Rate on screen: the typed one when it reads, else the saved one. `sah` false while the typing does not read. */
  function tarif(r: Ringkas) {
    const typed = ketik[r.id];
    if (typed === undefined) return { persen: r.persen_pajak, sah: true, berubah: false };
    const p = bacaPersen(typed);
    return { persen: p ?? r.persen_pajak, sah: p !== null, berubah: p !== r.persen_pajak };
  }
  const pajak = (r: Ringkas) => pajakRekanan(r.pendapatan, tarif(r).persen);
  const bersih = (r: Ringkas) => r.pendapatan - r.biaya - pajak(r);

  const total = $derived(
    data.ringkas.reduce(
      (a, r) => ({ t: a.t + r.transaksi, p: a.p + r.pendapatan, b: a.b + r.biaya, x: a.x + pajak(r), n: a.n + bersih(r) }),
      { t: 0, p: 0, b: 0, x: 0, n: 0 }
    )
  );

  const simpanPajak = (id: number) =>
    withFeedback({
      failTitle: 'Potongan pajak gagal disimpan',
      onPending: (p) => (menyimpan = p ? id : null),
      onSuccess: () => delete ketik[id]
    });

  function pilih(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    const url = new URL(page.url);
    if (v) url.searchParams.set('pemilik', v);
    else url.searchParams.delete('pemilik');
    goto(url, { keepFocus: true, noScroll: true });
  }

  const TH = 'font-semibold py-2.5 px-3 whitespace-nowrap';
  const TD = 'py-2.5 px-3 text-right num whitespace-nowrap';
</script>

{#snippet formPajak(r: Ringkas)}
  {@const t = tarif(r)}
  {#if data.canWrite}
    <form method="POST" action="?/pajak" use:enhance={simpanPajak(r.id)} class="inline-flex items-center gap-1 justify-end">
      <input type="hidden" name="entity_id" value={data.opEntity?.id} />
      <input type="hidden" name="pemilik_id" value={r.id} />
      <input type="hidden" name="bulan" value={data.periode.bulan} />
      <input type="hidden" name="tahun" value={data.periode.tahun} />
      <input
        name="persen"
        value={teksPersen(r)}
        oninput={(e) => (ketik[r.id] = e.currentTarget.value)}
        inputmode="decimal"
        aria-label="Potongan pajak {r.nama} (persen)"
        aria-invalid={!t.sah}
        class="w-[58px] h-[28px] px-2 text-right num bg-background border rounded-md text-[13px] text-foreground focus:outline-none focus:border-primary {t.sah ? 'border-border' : 'border-destructive'}"
      />
      <span class="text-muted-foreground">%</span>
      {#if t.berubah || !r.persen_diisi}
        <button type="submit" disabled={menyimpan === r.id || !t.sah} class="h-[28px] px-2 rounded-md border border-border text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-60">
          {menyimpan === r.id ? '…' : 'Simpan'}
        </button>
      {/if}
    </form>
  {:else}
    {labelPersen(r.persen_pajak)}
  {/if}
  {#if !r.persen_diisi && !t.berubah}
    <div class="text-[11px] text-subtle mt-0.5" title="Belum diisi untuk bulan ini; dipakai tarif bawaan">bawaan</div>
  {/if}
{/snippet}

<svelte:head><title>Laporan Partner · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <div>
      <a href="/operasional/laporan?{q}" class="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft size={13} /> Laporan</a>
      <h1 class="text-[17px] font-semibold text-foreground mt-1">Laporan Partner</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">Pembayaran truk per pemilik kendaraan · {namaBulan}</p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
      <UnduhExcel laporan="partner" />
      <label class="sr-only" for="pilih-pemilik">Pemilik</label>
      <select id="pilih-pemilik" value={data.dipilih?.id ?? ''} onchange={pilih} class="h-[30px] px-2 bg-background border border-border rounded-md text-[13px] text-foreground focus:outline-none focus:border-primary max-w-[240px]">
        <option value="">Semua pemilik / rekanan</option>
        {#each data.ringkas as p (p.id)}<option value={p.id}>{p.nama}</option>{/each}
      </select>
      {#if data.dipilih}
        <a href="/cetak/operasional/partner?{q}&pemilik={data.dipilih.id}" target="_blank" rel="noopener" class={BTN_SOFT}><Printer size={14} /> Cetak Rekap</a>
      {/if}
    </div>
  </div>

  {#if !data.dipilih}
    <div class="bg-card border border-border rounded-lg overflow-x-auto">
      <table class="w-full min-w-[1040px] text-[13px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="{TH} text-left">Nama Pemilik / Rekanan</th>
            <th class="{TH} text-right">Jumlah Armada</th>
            <th class="{TH} text-right">Total Transaksi</th>
            <th class="{TH} text-right">Pendapatan Bruto Rekanan</th>
            <th class="{TH} text-right">Biaya (Saku + Terpal)</th>
            <th class="{TH} text-right">Potongan Pajak (%)</th>
            <th class="{TH} text-right">Nominal Pajak</th>
            <th class="{TH} text-right">Jumlah Bersih</th>
            <th class="{TH} text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each data.ringkas as r (r.id)}
            <tr class="border-b border-border/40 hover:bg-muted/40">
              <td class="py-2.5 px-3 font-semibold text-foreground">{r.nama}</td>
              <td class={TD}>{r.kendaraan}</td>
              <td class={TD}>{r.transaksi}</td>
              <td class={TD}>{rupiah(r.pendapatan)}</td>
              <td class={TD}>{rupiah(r.biaya)}</td>
              <td class="py-2 px-3 text-right num whitespace-nowrap">{@render formPajak(r)}</td>
              <td class={TD}>{rupiah(pajak(r))}</td>
              <td class="{TD} font-semibold text-foreground">{rupiah(bersih(r))}</td>
              <td class="py-2 px-3 text-right"><a href="?{q}&pemilik={r.id}" class="text-primary hover:underline">Rincian</a></td>
            </tr>
          {:else}
            <tr><td colspan="9" class="py-10 text-center text-muted-foreground">Belum ada pemilik kendaraan.</td></tr>
          {/each}
        </tbody>
        {#if data.ringkas.length}
          <tfoot>
            <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
              <td class="py-2.5 px-3" colspan="2">TOTAL</td>
              <td class={TD}>{total.t}</td>
              <td class={TD}>{rupiah(total.p)}</td>
              <td class={TD}>{rupiah(total.b)}</td>
              <td></td>
              <td class={TD}>{rupiah(total.x)}</td>
              <td class={TD}>{rupiah(total.n)}</td>
              <td></td>
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>

    <p class="text-[12px] text-muted-foreground -mt-2">
      Nominal pajak = pendapatan bruto × potongan pajak, dibulatkan ke rupiah. Jumlah bersih = bruto − saku − terpal − nominal pajak.
      Potongan pajak berlaku per pemilik per bulan; bila belum diisi dipakai {labelPersen(TARIF_PAJAK_REKANAN)} (bawaan). Laporan per Kapal memakai persentase yang sama.
    </p>

    <section class="space-y-2">
      <h2 class="text-[14px] font-semibold text-foreground">Rincian Pembayaran Truk per kegiatan · {namaBulan}</h2>
      <div class="flex flex-wrap gap-2">
        {#each data.kegiatan as k (k.id)}
          <a href="/operasional/kegiatan/{k.id}/pembayaran?{q}" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card text-[13px] hover:border-primary/50 {k.truk === 0 ? 'opacity-60' : ''}">
            <Wallet size={13} class="text-muted-foreground" /> {k.nama_kapal} · {k.rute ?? '-'} · {k.truk} truk
          </a>
        {:else}
          <p class="text-[13px] text-muted-foreground">Belum ada kegiatan kapal bulan ini.</p>
        {/each}
      </div>
    </section>
  {:else}
    <div class="bg-card border border-border rounded-lg overflow-x-auto">
      <table class="w-full min-w-[1150px] text-[13px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="{TH} text-left">Tanggal Kegiatan</th>
            <th class="{TH} text-left">Nopol</th>
            <th class="{TH} text-left">Nama Kapal</th>
            <th class="{TH} text-left">Rute</th>
            <th class="{TH} text-right">Ritase</th>
            <th class="{TH} text-right">Tonase (MT)</th>
            <th class="{TH} text-right">Ongkos Angkut</th>
            <th class="{TH} text-right">Pendapatan Bruto</th>
            <th class="{TH} text-right">Saku Supir</th>
            <th class="{TH} text-right">Uang Terpal</th>
            <th class="{TH} text-right">Bersih (sebelum pajak)</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rincian as r, i (i)}
            <tr class="border-b border-border/40 hover:bg-muted/40">
              <td class="py-2.5 px-3 num whitespace-nowrap">{rentangTanggal(r.tanggal_kegiatan, r.tanggal_selesai)}</td>
              <td class="py-2.5 px-3 font-semibold text-foreground whitespace-nowrap">{r.nopol}</td>
              <td class="py-2.5 px-3">{r.kapal}</td>
              <td class="py-2.5 px-3">{r.rute}</td>
              <td class={TD}>{r.ritase}</td>
              <td class={TD}>{ton(r.tonase)}</td>
              <td class={TD}>{rupiah(r.ongkos_angkut)}</td>
              <td class={TD}>{rupiah(r.pendapatan)}</td>
              <td class={TD}>{rupiah(r.sangu_supir)}</td>
              <td class={TD}>{rupiah(r.terpal)}</td>
              <td class="{TD} font-semibold text-foreground">{rupiah(r.bersih)}</td>
            </tr>
          {:else}
            <tr><td colspan="11" class="py-10 text-center text-muted-foreground">Truk {data.dipilih.nama} tidak punya transaksi di {namaBulan}.</td></tr>
          {/each}
        </tbody>
        {#if data.rincian.length}
          <tfoot>
            <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
              <td class="py-2.5 px-3" colspan="4">TOTAL KESELURUHAN</td>
              <td class={TD}>{data.jumlah.ritase}</td>
              <td class={TD}>{ton(data.jumlah.tonase)}</td>
              <td></td>
              <td class={TD}>{rupiah(data.jumlah.pendapatan)}</td>
              <td class={TD}>{rupiah(data.jumlah.sangu_supir)}</td>
              <td class={TD}>{rupiah(data.jumlah.terpal)}</td>
              <td class={TD}>{rupiah(data.jumlah.bersih)}</td>
            </tr>
            <tr class="text-foreground">
              <td class="py-2 px-3 font-semibold text-right" colspan="10">Potongan pajak</td>
              <td class="py-2 px-3 text-right">{@render formPajak(data.dipilih)}</td>
            </tr>
            <tr class="text-foreground">
              <td class="py-2 px-3 font-semibold text-right" colspan="10">Nominal pajak</td>
              <td class={TD}>{rupiah(pajak(data.dipilih))}</td>
            </tr>
            <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
              <td class="py-2.5 px-3 text-right" colspan="10">JUMLAH BERSIH SETELAH PAJAK</td>
              <td class={TD}>{rupiah(bersih(data.dipilih))}</td>
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>
  {/if}
</div>
