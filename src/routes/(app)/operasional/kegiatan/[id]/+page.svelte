<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Plus from 'lucide-svelte/icons/plus';
  import Ship from 'lucide-svelte/icons/ship';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Truck from 'lucide-svelte/icons/truck';
  import Wallet from 'lucide-svelte/icons/wallet';
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { withFeedback } from '$lib/form-feedback';
  import { NAMA_BULAN, bacaAngka, pecahRute, ton } from '$lib/operasional/kegiatan';
  import { BTN_ICON_DANGER, BTN_PRIMARY, BTN_SOFT, FIELD, LABEL, TEXTAREA } from '$lib/operasional/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  /** One editable truck line. Text, because that is what the inputs hold. */
  interface Baris {
    key: number;
    nopol: string;
    pemilik_id: string;
    pemilik_baru: string;
    ritase: string;
    tonase: string;
  }

  const ASAL = ['Gudang Veteran', 'KIG', 'Manyar', 'Pabrik Wilmar'];
  const PEMILIK_BARU = 'baru';

  let nextKey = 0;
  const kosong = (): Baris => ({ key: nextKey++, nopol: '', pemilik_id: '', pemilik_baru: '', ritase: '1', tonase: '' });

  function dariData(): Baris[] {
    return data.truk.map((t) => ({
      key: nextKey++,
      nopol: t.nopol,
      pemilik_id: '',
      pemilik_baru: '',
      ritase: String(t.ritase),
      tonase: t.tonase ? String(t.tonase).replace('.', ',') : ''
    }));
  }

  let baris = $state<Baris[]>(untrack(dariData));
  let pemilikMassal = $state('');
  let saving = $state(false);

  const rute = $derived(pecahRute(data.kegiatan.rute));
  const entityQuery = $derived(data.opEntity ? `entitas=${encodeURIComponent(data.opEntity.code)}` : '');
  const kembaliHref = $derived(
    `/operasional/kegiatan?${entityQuery}&bulan=${data.kegiatan.bulan}&tahun=${data.kegiatan.tahun}`
  );

  const pemilikPerNopol = $derived(
    new Map(data.kendaraan.map((k) => [k.nopol.toUpperCase(), data.pemilik.find((p) => p.id === k.pemilik_id)?.nama ?? '—']))
  );
  const nopolTerdaftar = (nopol: string) => pemilikPerNopol.get(nopol.trim().replace(/\s+/g, ' ').toUpperCase());

  const jumlah = $derived({
    truk: baris.filter((b) => b.nopol.trim() !== '').length,
    ritase: baris.reduce((n, b) => n + (Number(b.ritase) || 0), 0),
    tonase: baris.reduce((n, b) => n + (bacaAngka(b.tonase) ?? 0), 0)
  });

  const trukJson = $derived(
    JSON.stringify(
      baris.map((b) => ({
        nopol: b.nopol,
        pemilik_id: b.pemilik_id === PEMILIK_BARU ? '' : b.pemilik_id,
        pemilik_baru: b.pemilik_id === PEMILIK_BARU ? b.pemilik_baru : '',
        ritase: b.ritase,
        tonase: b.tonase
      }))
    )
  );

  /** Every truck of one owner not yet listed — the old "kelompok pemilik". */
  function tambahTrukPemilik() {
    const id = Number(pemilikMassal);
    if (!id) return;
    const sudah = new Set(baris.map((b) => b.nopol.trim().toUpperCase()));
    const baru = data.kendaraan
      .filter((k) => k.pemilik_id === id && !sudah.has(k.nopol.toUpperCase()))
      .map((k) => ({ ...kosong(), nopol: k.nopol }));
    // Replace a single untouched empty line instead of leaving it above.
    const isi = baris.filter((b) => b.nopol.trim() !== '' || b.tonase.trim() !== '');
    baris = [...isi, ...baru];
    pemilikMassal = '';
  }

  function format(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '');
    input.value = digits === '' ? '' : new Intl.NumberFormat('id-ID').format(Number(digits));
  }

  const save = withFeedback({
    failTitle: 'Detail kegiatan gagal disimpan',
    onSuccess: () => (baris = dariData()),
    onPending: (pending) => (saving = pending)
  });
</script>

<svelte:head><title>Lengkapi Data · {data.kegiatan.nama_kapal} · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4 max-w-[1100px]">
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <div>
      <a href={kembaliHref} class="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
        <ArrowLeft size={13} /> Detail Kegiatan Kapal
      </a>
      <h1 class="text-[15px] font-semibold text-foreground mt-1 inline-flex items-center gap-2">
        <Ship size={15} class="text-muted-foreground" />
        {data.canWrite ? 'Lengkapi Data Kegiatan' : 'Rincian Kegiatan'} · {data.kegiatan.nama_kapal}
      </h1>
      <p class="text-[12px] text-muted-foreground mt-0.5">
        {NAMA_BULAN[data.kegiatan.bulan - 1]}
        {data.kegiatan.tahun} · rute, biaya operasional, petugas telly, dan armada truk
      </p>
    </div>
    {#if data.truk.length > 0}
      <a href="/operasional/kegiatan/{data.kegiatan.id}/pembayaran?{entityQuery}" class={BTN_SOFT}>
        <Wallet size={14} /> Rincian Pembayaran Truk
      </a>
    {/if}
  </div>

  <form method="POST" action="?/simpan" use:enhance={save} class="space-y-4">
    <input type="hidden" name="entity_id" value={data.opEntity?.id} />
    <input type="hidden" name="truk" value={trukJson} />

    <fieldset disabled={!data.canWrite} class="space-y-4">
      <section class="bg-card border border-border rounded-lg p-4 space-y-3">
        <h2 class="text-[13px] font-semibold text-foreground">Data Kegiatan</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label class="block">
            <span class={LABEL}>Rute asal</span>
            <input name="rute_asal" value={rute.asal} list="daftar-asal" placeholder="cth. Gudang Veteran" class={FIELD} />
          </label>
          <label class="block">
            <span class={LABEL}>Rute tujuan</span>
            <input name="rute_tujuan" value={rute.tujuan} placeholder="Kapal/Pelabuhan" class={FIELD} />
          </label>
          <label class="block">
            <span class={LABEL}>Biaya operasional (Rp)</span>
            <input
              name="operasional"
              inputmode="numeric"
              value={data.kegiatan.operasional ? new Intl.NumberFormat('id-ID').format(data.kegiatan.operasional) : ''}
              oninput={format}
              placeholder="0"
              class="{FIELD} text-right num"
            />
          </label>
          <label class="block">
            <span class={LABEL}>Petugas telly</span>
            <select name="telly_id" value={data.kegiatan.telly_id ?? ''} class={FIELD}>
              <option value="">— Tanpa telly —</option>
              {#each data.telly as k (k.id)}
                <option value={k.id}>{k.nama}{k.jabatan ? ` · ${k.jabatan}` : ''}</option>
              {/each}
            </select>
          </label>
          <label class="block">
            <span class={LABEL}>Tanggal input</span>
            <input type="date" name="tanggal_input" value={data.kegiatan.tanggal_input ?? ''} class={FIELD} />
          </label>
          <label class="block">
            <span class={LABEL}>Tanggal kegiatan (mulai)</span>
            <input type="date" name="tanggal_kegiatan" value={data.kegiatan.tanggal_kegiatan ?? ''} class={FIELD} />
          </label>
          <label class="block">
            <span class={LABEL}>Sampai tanggal (selesai)</span>
            <input type="date" name="tanggal_selesai" value={data.kegiatan.tanggal_selesai ?? ''} class={FIELD} />
          </label>
        </div>
        <label class="block">
          <span class={LABEL}>Keterangan <span class="text-subtle">(opsional)</span></span>
          <textarea name="keterangan" value={data.kegiatan.keterangan ?? ''} class={TEXTAREA}></textarea>
        </label>
        <p class="text-[11px] text-muted-foreground">
          Honor telly dihitung otomatis: tonase kegiatan × tarif telly petugas (Rp 400/ton bila tarifnya belum diisi).
        </p>
      </section>

      <section class="bg-card border border-border rounded-lg overflow-hidden">
        <div class="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-border">
          <h2 class="text-[13px] font-semibold text-foreground inline-flex items-center gap-2">
            <Truck size={14} class="text-muted-foreground" /> Armada Truk
          </h2>
          {#if data.canWrite}
            <div class="flex items-center gap-2 flex-wrap">
              <label class="sr-only" for="pemilik-massal">Pemilik</label>
              <select id="pemilik-massal" bind:value={pemilikMassal} class="{FIELD} w-[220px]">
                <option value="">Tambah semua truk milik…</option>
                {#each data.pemilik as p (p.id)}<option value={String(p.id)}>{p.nama}</option>{/each}
              </select>
              <button type="button" onclick={tambahTrukPemilik} disabled={!pemilikMassal} class={BTN_SOFT}>Tambahkan</button>
            </div>
          {/if}
        </div>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] text-[12px]">
            <thead>
              <tr class="text-muted-foreground border-b border-border">
                <th class="font-medium py-2 px-3 text-center w-[40px]">#</th>
                <th class="font-medium py-2 px-3 text-left w-[180px]">Plat Nomor (Nopol)</th>
                <th class="font-medium py-2 px-3 text-left">Pemilik Kendaraan</th>
                <th class="font-medium py-2 px-3 text-right w-[110px]">Ritase</th>
                <th class="font-medium py-2 px-3 text-right w-[140px]">Tonase (MT)</th>
                <th class="w-[48px]"></th>
              </tr>
            </thead>
            <tbody>
              {#each baris as b, i (b.key)}
                {@const pemilikTerdaftar = nopolTerdaftar(b.nopol)}
                <tr class="border-b border-border/40 align-top">
                  <td class="py-2 px-3 text-center text-muted-foreground num">{i + 1}</td>
                  <td class="py-2 px-3">
                    <input
                      bind:value={b.nopol}
                      list="daftar-nopol"
                      aria-label="Plat nomor truk {i + 1}"
                      placeholder="cth. W 1234 AB"
                      autocomplete="off"
                      class="{FIELD} uppercase"
                    />
                  </td>
                  <td class="py-2 px-3">
                    {#if b.nopol.trim() === ''}
                      <span class="text-subtle leading-[34px]">—</span>
                    {:else if pemilikTerdaftar}
                      <span class="leading-[34px] text-foreground">{pemilikTerdaftar}</span>
                    {:else}
                      <div class="flex gap-2">
                        <select bind:value={b.pemilik_id} aria-label="Pemilik truk {b.nopol}" class="{FIELD} max-w-[220px]">
                          <option value="">Truk baru — pilih pemilik…</option>
                          {#each data.pemilik as p (p.id)}<option value={String(p.id)}>{p.nama}</option>{/each}
                          <option value={PEMILIK_BARU}>+ Pemilik baru…</option>
                        </select>
                        {#if b.pemilik_id === PEMILIK_BARU}
                          <input bind:value={b.pemilik_baru} placeholder="Nama pemilik baru" aria-label="Nama pemilik baru" class={FIELD} />
                        {/if}
                      </div>
                    {/if}
                  </td>
                  <td class="py-2 px-3">
                    <input bind:value={b.ritase} inputmode="numeric" aria-label="Ritase {b.nopol}" class="{FIELD} text-right num" />
                  </td>
                  <td class="py-2 px-3">
                    <input bind:value={b.tonase} inputmode="decimal" placeholder="0" aria-label="Tonase {b.nopol}" class="{FIELD} text-right num" />
                  </td>
                  <td class="py-2 px-2 text-center">
                    {#if data.canWrite}
                      <button
                        type="button"
                        onclick={() => (baris = baris.filter((x) => x.key !== b.key))}
                        class="{BTN_ICON_DANGER} mt-1"
                        aria-label="Keluarkan truk {b.nopol || i + 1}"
                        title="Keluarkan dari kegiatan"
                      >
                        <Trash2 size={14} />
                      </button>
                    {/if}
                  </td>
                </tr>
              {:else}
                <tr>
                  <td colspan="6" class="py-8 px-4 text-center text-[12px] text-muted-foreground">
                    Belum ada truk pada kegiatan ini.
                  </td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
                <td class="py-2 px-3" colspan="3">
                  {#if data.canWrite}
                    <button type="button" onclick={() => (baris = [...baris, kosong()])} class="{BTN_SOFT} h-[28px] px-3 text-[12px]">
                      <Plus size={13} /> Tambah truk
                    </button>
                  {/if}
                  <span class="ml-2 font-normal text-muted-foreground">{jumlah.truk} truk</span>
                </td>
                <td class="py-2 px-3 text-right num">{jumlah.ritase}</td>
                <td class="py-2 px-3 text-right num">{ton(jumlah.tonase)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p class="px-4 py-2.5 text-[11px] text-muted-foreground border-t border-border">
          Truk yang sudah terdaftar tetap pada pemiliknya — ubah pemilik di Master Kendaraan. Ongkos angkut, saku
          supir, dan terpal diisi di Rincian Pembayaran Truk.
        </p>
      </section>
    </fieldset>

    {#if data.canWrite}
      <div class="flex justify-end gap-2">
        <a href={kembaliHref} class={BTN_SOFT}>Kembali</a>
        <button type="submit" disabled={saving} class={BTN_PRIMARY}>
          {saving ? 'Menyimpan…' : 'Simpan Detail Kegiatan'}
        </button>
      </div>
    {/if}
  </form>
</div>

<datalist id="daftar-asal">
  {#each ASAL as a (a)}<option value={a}></option>{/each}
</datalist>
<datalist id="daftar-nopol">
  {#each data.kendaraan as k (k.nopol)}<option value={k.nopol}></option>{/each}
</datalist>
