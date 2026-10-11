<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import ClipboardList from 'lucide-svelte/icons/clipboard-list';
  import Wallet from 'lucide-svelte/icons/wallet';
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { withFeedback } from '$lib/form-feedback';
  import { NAMA_BULAN, bacaAngka, bacaRupiah, ton } from '$lib/operasional/kegiatan';
  import { BTN_PRIMARY, BTN_SOFT, FIELD, rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const angkaRp = (n: number) => (n ? new Intl.NumberFormat('id-ID').format(n) : '');

  function dariData() {
    return data.truk.map((t) => ({
      id: t.id,
      nopol: t.nopol,
      pemilik: t.pemilik,
      tarif: t.tarif_paguyuban,
      ritase: String(t.ritase),
      tonase: t.tonase ? String(t.tonase).replace('.', ',') : '',
      ongkos_angkut: angkaRp(t.ongkos_angkut),
      sangu_supir: angkaRp(t.sangu_supir),
      terpal: angkaRp(t.terpal)
    }));
  }

  let baris = $state(untrack(dariData));
  let ongkosSemua = $state('');
  let saving = $state(false);

  const entityQuery = $derived(data.opEntity ? `entitas=${encodeURIComponent(data.opEntity.code)}` : '');
  const kembaliHref = $derived(
    `/operasional/kegiatan?${entityQuery}&bulan=${data.kegiatan.bulan}&tahun=${data.kegiatan.tahun}`
  );

  // Same formulas as simpan_pembayaran_truk(), shown before saving.
  const hitung = $derived(
    baris.map((b) => {
      const tonase = bacaAngka(b.tonase) ?? 0;
      return {
        beban: tonase * (bacaRupiah(b.ongkos_angkut) ?? 0),
        paguyuban: tonase > 0 ? tonase * b.tarif : 0
      };
    })
  );

  const jumlah = $derived({
    ritase: baris.reduce((n, b) => n + (Number(b.ritase) || 0), 0),
    tonase: baris.reduce((n, b) => n + (bacaAngka(b.tonase) ?? 0), 0),
    beban: hitung.reduce((n, h) => n + h.beban, 0),
    sangu: baris.reduce((n, b) => n + (bacaRupiah(b.sangu_supir) ?? 0), 0),
    terpal: baris.reduce((n, b) => n + (bacaRupiah(b.terpal) ?? 0), 0),
    paguyuban: hitung.reduce((n, h) => n + h.paguyuban, 0)
  });

  const trukJson = $derived(JSON.stringify(baris.map(({ pemilik: _p, tarif: _t, ...rest }) => rest)));

  /** Rupiah fields show thousands separators as they are typed. */
  function rp(value: string): string {
    const digits = value.replace(/\D/g, '');
    return digits === '' ? '' : new Intl.NumberFormat('id-ID').format(Number(digits));
  }

  function terapkanOngkos() {
    const nilai = rp(ongkosSemua);
    baris = baris.map((b) => ({ ...b, ongkos_angkut: nilai }));
  }

  const save = withFeedback({
    failTitle: 'Rincian pembayaran gagal disimpan',
    onSuccess: () => (baris = dariData()),
    onPending: (pending) => (saving = pending)
  });

  const INPUT = `${FIELD} text-right num h-[30px] px-2`;
  const TH = 'font-medium py-2 px-2';
</script>

<svelte:head><title>Rincian Pembayaran Truk · {data.kegiatan.nama_kapal} · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <div>
      <a href={kembaliHref} class="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
        <ArrowLeft size={13} /> Detail Kegiatan Kapal
      </a>
      <h1 class="text-[15px] font-semibold text-foreground mt-1 inline-flex items-center gap-2">
        <Wallet size={15} class="text-muted-foreground" />
        Rincian Pembayaran Truk · {data.kegiatan.nama_kapal}
      </h1>
      <p class="text-[12px] text-muted-foreground mt-0.5">
        {NAMA_BULAN[data.kegiatan.bulan - 1]}
        {data.kegiatan.tahun} · {data.kegiatan.rute ?? '-'} · {baris.length} truk
      </p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      {#if data.canWrite && baris.length > 0}
        <label class="sr-only" for="ongkos-semua">Ongkos angkut untuk semua truk</label>
        <input
          id="ongkos-semua"
          value={ongkosSemua}
          oninput={(e) => (ongkosSemua = rp(e.currentTarget.value))}
          inputmode="numeric"
          placeholder="Ongkos / ton untuk semua"
          class="{FIELD} w-[190px] text-right num"
        />
        <button type="button" onclick={terapkanOngkos} disabled={!ongkosSemua} class={BTN_SOFT}>Terapkan</button>
      {/if}
      <a href="/operasional/kegiatan/{data.kegiatan.id}?{entityQuery}" class={BTN_SOFT}>
        <ClipboardList size={14} /> Lengkapi Data
      </a>
    </div>
  </div>

  <form method="POST" action="?/simpan" use:enhance={save} class="space-y-4">
    <input type="hidden" name="truk" value={trukJson} />

    <div class="bg-card border border-border rounded-lg overflow-hidden">
      <div class="overflow-x-auto">
        <fieldset disabled={!data.canWrite}>
          <table class="w-full min-w-[1120px] text-[12px]">
            <thead>
              <tr class="text-muted-foreground border-b border-border">
                <th class="{TH} text-center w-[36px]">#</th>
                <th class="{TH} text-left">Pemilik</th>
                <th class="{TH} text-left">Nopol</th>
                <th class="{TH} text-right w-[76px]">Ritase</th>
                <th class="{TH} text-right w-[100px]">Tonase (MT)</th>
                <th class="{TH} text-right w-[130px]">Ongkos / Ton</th>
                <th class="{TH} text-right">Beban Rekanan</th>
                <th class="{TH} text-right w-[130px]">Saku Supir</th>
                <th class="{TH} text-right w-[120px]">Terpal</th>
                <th class="{TH} text-right">Paguyuban</th>
              </tr>
            </thead>
            <tbody>
              {#each baris as b, i (b.id)}
                <tr class="border-b border-border/40 hover:bg-muted/30">
                  <td class="py-1.5 px-2 text-center text-muted-foreground num">{i + 1}</td>
                  <td class="py-1.5 px-2">{b.pemilik}</td>
                  <td class="py-1.5 px-2 font-semibold text-foreground whitespace-nowrap">{b.nopol}</td>
                  <td class="py-1.5 px-2"><input bind:value={b.ritase} inputmode="numeric" aria-label="Ritase {b.nopol}" class={INPUT} /></td>
                  <td class="py-1.5 px-2"><input bind:value={b.tonase} inputmode="decimal" aria-label="Tonase {b.nopol}" class={INPUT} /></td>
                  <td class="py-1.5 px-2">
                    <input
                      value={b.ongkos_angkut}
                      oninput={(e) => (b.ongkos_angkut = rp(e.currentTarget.value))}
                      inputmode="numeric"
                      aria-label="Ongkos angkut per ton {b.nopol}"
                      class={INPUT}
                    />
                  </td>
                  <td class="py-1.5 px-2 text-right num whitespace-nowrap">{rupiah(hitung[i].beban)}</td>
                  <td class="py-1.5 px-2">
                    <input
                      value={b.sangu_supir}
                      oninput={(e) => (b.sangu_supir = rp(e.currentTarget.value))}
                      inputmode="numeric"
                      aria-label="Saku supir {b.nopol}"
                      class={INPUT}
                    />
                  </td>
                  <td class="py-1.5 px-2">
                    <input
                      value={b.terpal}
                      oninput={(e) => (b.terpal = rp(e.currentTarget.value))}
                      inputmode="numeric"
                      aria-label="Terpal {b.nopol}"
                      class={INPUT}
                    />
                  </td>
                  <td class="py-1.5 px-2 text-right num whitespace-nowrap text-muted-foreground">{rupiah(hitung[i].paguyuban)}</td>
                </tr>
              {:else}
                <tr>
                  <td colspan="10" class="py-10 px-4 text-center text-[12px] text-muted-foreground">
                    Belum ada truk pada kegiatan ini.
                    <a href="/operasional/kegiatan/{data.kegiatan.id}?{entityQuery}" class="text-primary hover:underline">Isi daftar truk</a>
                    di Lengkapi Data lebih dulu.
                  </td>
                </tr>
              {/each}
            </tbody>
            {#if baris.length > 0}
              <tfoot>
                <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
                  <td class="py-2 px-2" colspan="3">TOTAL</td>
                  <td class="py-2 px-2 text-right num">{jumlah.ritase}</td>
                  <td class="py-2 px-2 text-right num">{ton(jumlah.tonase)}</td>
                  <td></td>
                  <td class="py-2 px-2 text-right num">{rupiah(jumlah.beban)}</td>
                  <td class="py-2 px-2 text-right num">{rupiah(jumlah.sangu)}</td>
                  <td class="py-2 px-2 text-right num">{rupiah(jumlah.terpal)}</td>
                  <td class="py-2 px-2 text-right num">{rupiah(jumlah.paguyuban)}</td>
                </tr>
              </tfoot>
            {/if}
          </table>
        </fieldset>
      </div>
      <p class="px-4 py-2.5 text-[11px] text-muted-foreground border-t border-border">
        Beban rekanan = tonase × ongkos angkut per ton, dibayarkan ke pemilik truk. Iuran paguyuban = tonase × tarif
        (Rp 500/ton bila belum disesuaikan) dan masih bisa dikoreksi di laporan keuangan.
      </p>
    </div>

    {#if data.canWrite && baris.length > 0}
      <div class="flex justify-end gap-2">
        <a href={kembaliHref} class={BTN_SOFT}>Kembali</a>
        <button type="submit" disabled={saving} class={BTN_PRIMARY}>
          {saving ? 'Menyimpan…' : 'Simpan Rincian Pembayaran'}
        </button>
      </div>
    {/if}
  </form>
</div>
