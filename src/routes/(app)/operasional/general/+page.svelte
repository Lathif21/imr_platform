<script lang="ts">
  import ClipboardList from 'lucide-svelte/icons/clipboard-list';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Plus from 'lucide-svelte/icons/plus';
  import Search from 'lucide-svelte/icons/search';
  import Ship from 'lucide-svelte/icons/ship';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import FormModal from '$lib/components/FormModal.svelte';
  import { withFeedback } from '$lib/form-feedback';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, bulanIni, rentangTanggal, ton } from '$lib/operasional/kegiatan';
  import { BTN_ICON, BTN_ICON_DANGER, BTN_PRIMARY, BTN_SOFT, FIELD, LABEL, TEXTAREA, matches } from '$lib/operasional/ui';
  import type { PageData } from './$types';
  import type { KegiatanRow } from './+page.server';

  let { data }: { data: PageData } = $props();

  let query = $state('');
  let modalOpen = $state(untrack(() => data.bukaTambah && data.canWrite));
  let editing = $state<KegiatanRow | null>(null);
  let saving = $state(false);

  // Form fields that depend on each other: Bulan Pengiriman follows the
  // activity date (PR #5 di Laravel), and can still be changed afterwards.
  let bulan = $state(untrack(() => data.periode.bulan));
  let tahun = $state(untrack(() => data.periode.tahun));
  let tanggalKegiatan = $state('');
  let tanggalSelesai = $state('');

  const entityQuery = $derived(data.opEntity ? `entitas=${encodeURIComponent(data.opEntity.code)}` : '');
  const rows = $derived(data.kegiatan.filter((row) => matches(query, row.nama_kapal, row.rute, ...row.pemilik)));
  const tahunPilihan = $derived.by(() => {
    const now = bulanIni().tahun;
    const from = Math.min(tahun, now - 3);
    const to = Math.max(tahun, now + 1);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });

  const lengkap = (row: KegiatanRow) => row.jumlah_truk > 0 || row.tonase > 0 || row.trips > 0;

  function openCreate() {
    editing = null;
    bulan = data.periode.bulan;
    tahun = data.periode.tahun;
    tanggalKegiatan = '';
    tanggalSelesai = '';
    modalOpen = true;
  }

  function openEdit(row: KegiatanRow) {
    editing = row;
    bulan = data.periode.bulan;
    tahun = data.periode.tahun;
    tanggalKegiatan = row.tanggal_kegiatan ?? '';
    tanggalSelesai = row.tanggal_selesai ?? '';
    modalOpen = true;
  }

  function ikutiTanggal() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalKegiatan)) return;
    tahun = Number(tanggalKegiatan.slice(0, 4));
    bulan = Number(tanggalKegiatan.slice(5, 7));
    if (tanggalSelesai && tanggalSelesai < tanggalKegiatan) tanggalSelesai = tanggalKegiatan;
  }

  const save = withFeedback({
    failTitle: 'Data kapal gagal disimpan',
    onSuccess: () => (modalOpen = false),
    onPending: (pending) => (saving = pending)
  });

  function remove(row: KegiatanRow) {
    const isi =
      row.jumlah_truk > 0
        ? `${row.jumlah_truk} rincian truk beserta iuran paguyuban dan honor telly kegiatan ini akan ikut terhapus dan tidak bisa dikembalikan.`
        : 'Data yang dihapus tidak bisa dikembalikan.';
    return withFeedback({
      failTitle: 'Data kegiatan gagal dihapus',
      confirm: {
        title: 'Hapus data kegiatan kapal?',
        message: `Kegiatan ${row.nama_kapal} (${row.rute ?? '-'}) akan dihapus.`,
        consequence: `${isi} Laporan pendapatan tidak ikut terhapus.`,
        confirmLabel: 'Ya, hapus',
        tone: 'danger'
      }
    });
  }
</script>

<svelte:head><title>Database General · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-[17px] font-semibold text-foreground">Database General</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">
        Data kegiatan kapal · {NAMA_BULAN[data.periode.bulan - 1]}
        {data.periode.tahun} · {data.kegiatan.length} kegiatan
      </p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
      <div class="relative">
        <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
        <input
          bind:value={query}
          type="search"
          placeholder="Cari kapal, rute, pemilik…"
          aria-label="Cari kegiatan"
          class="{FIELD} pl-8 w-[220px]"
        />
      </div>
      {#if data.canWrite}
        <button type="button" onclick={openCreate} class={BTN_PRIMARY}>
          <Plus size={14} /> Tambah Data General
        </button>
      {/if}
    </div>
  </div>

  {#if data.trukTanpaKegiatan > 0}
    <div class="flex gap-2 items-start rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-[13px] text-foreground">
      <TriangleAlert size={14} class="mt-0.5 shrink-0 text-warning" />
      <p>
        Ada {data.trukTanpaKegiatan} rincian truk di bulan ini yang tidak terhubung ke kegiatan kapal mana pun
        (sisa data lama). Rincian itu tidak tampil di daftar ini, tetapi tetap terhitung di laporan.
        Hubungi admin sistem untuk menautkannya.
      </p>
    </div>
  {/if}

  <div class="bg-card border border-border rounded-lg overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[860px] text-[13px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="text-center font-semibold py-2.5 px-3 w-[44px]">No</th>
            <th class="text-left font-semibold py-2.5 px-3">Tanggal Input</th>
            <th class="text-left font-semibold py-2.5 px-3">Tanggal Kegiatan</th>
            <th class="text-left font-semibold py-2.5 px-3">Nama Kapal / VOY</th>
            <th class="text-left font-semibold py-2.5 px-3">Truk</th>
            <th class="text-left font-semibold py-2.5 px-3">Status Pengisian Data</th>
            <th class="text-right font-semibold py-2.5 px-3">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row, i (row.id)}
            <tr class="border-b border-border/40 last:border-b-0 hover:bg-muted/40">
              <td class="py-2.5 px-3 text-center text-muted-foreground num">{i + 1}</td>
              <td class="py-2.5 px-3 whitespace-nowrap num">{rentangTanggal(row.tanggal_input, null)}</td>
              <td class="py-2.5 px-3 whitespace-nowrap num">
                {rentangTanggal(row.tanggal_kegiatan, row.tanggal_selesai)}
              </td>
              <td class="py-2.5 px-3">
                <div class="inline-flex items-center gap-2 font-semibold text-foreground">
                  <Ship size={13} class="text-muted-foreground" />
                  {row.nama_kapal}
                </div>
                <div class="text-[12px] text-muted-foreground mt-0.5 pl-5">{row.rute ?? '-'}</div>
              </td>
              <td class="py-2.5 px-3">
                {#if row.jumlah_truk > 0}
                  <div class="num">{row.jumlah_truk} truk · {ton(row.tonase)} MT</div>
                  <div class="text-[12px] text-muted-foreground mt-0.5 max-w-[240px] truncate" title={row.pemilik.join(', ')}>
                    {row.pemilik.join(', ') || '—'}
                  </div>
                {:else}
                  <span class="text-subtle">—</span>
                {/if}
              </td>
              <td class="py-2.5 px-3">
                {#if lengkap(row)}
                  <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-positive/10 text-positive text-[12px] font-medium">
                    <span class="h-1.5 w-1.5 rounded-full bg-positive"></span> Sudah Lengkap
                  </span>
                {:else}
                  <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-warning/15 text-warning text-[12px] font-medium">
                    <span class="h-1.5 w-1.5 rounded-full bg-warning"></span> Belum Lengkap
                  </span>
                {/if}
              </td>
              <td class="py-2 px-3">
                <div class="flex justify-end items-center gap-1">
                  {#if data.canWrite}
                    <button
                      type="button"
                      onclick={() => openEdit(row)}
                      class={BTN_ICON}
                      aria-label="Ubah data {row.nama_kapal}"
                      title="Ubah data kapal & tanggal"
                    >
                      <Pencil size={14} />
                    </button>
                  {/if}
                  <a
                    href="/operasional/kegiatan/{row.id}?{entityQuery}"
                    class="h-[28px] px-2.5 rounded-md bg-primary/10 text-primary text-[12px] font-medium inline-flex items-center gap-1.5 hover:bg-primary/15"
                  >
                    <ClipboardList size={13} />
                    {data.canWrite ? 'Lengkapi Data' : 'Lihat Rincian'}
                  </a>
                  {#if data.canWrite}
                    <form method="POST" action="?/hapus" use:enhance={remove(row)}>
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" class={BTN_ICON_DANGER} aria-label="Hapus {row.nama_kapal}" title="Hapus">
                        <Trash2 size={14} />
                      </button>
                    </form>
                  {/if}
                </div>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="7" class="py-10 px-4 text-center text-[13px] text-muted-foreground">
                {#if query}
                  Tidak ada kegiatan yang cocok dengan "{query}".
                {:else}
                  Belum ada data general tersimpan untuk {NAMA_BULAN[data.periode.bulan - 1]}
                  {data.periode.tahun}.{data.canWrite ? ' Klik "Tambah Data General" untuk menambahkan.' : ''}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<datalist id="daftar-kapal">
  {#each data.daftarKapal as nama (nama)}<option value={nama}></option>{/each}
</datalist>

<FormModal bind:open={modalOpen} title={editing ? 'Ubah Data Kapal' : 'Tambah Data Kapal Baru'} wide>
  <form method="POST" action={editing ? '?/ubah' : '?/tambah'} use:enhance={save} class="space-y-4">
    <input type="hidden" name="entity_id" value={data.opEntity?.id} />
    <input type="hidden" name="tahun" value={tahun} />
    {#if editing}<input type="hidden" name="id" value={editing.id} />{/if}

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block">
        <span class={LABEL}>Nama kapal / VOY</span>
        <input
          name="nama_kapal"
          list="daftar-kapal"
          value={editing?.nama_kapal ?? ''}
          maxlength="255"
          autocomplete="off"
          placeholder="Ketik atau pilih nama kapal…"
          class={FIELD}
        />
        <span class="block text-[12px] text-subtle mt-1">Nama baru otomatis ditambahkan ke Master Kapal.</span>
      </label>
      <div class="grid grid-cols-[1fr_96px] gap-2">
        <label class="block">
          <span class={LABEL}>Bulan pengiriman</span>
          <select name="bulan" bind:value={bulan} class={FIELD}>
            {#each NAMA_BULAN as nama, i (nama)}<option value={i + 1}>{nama}</option>{/each}
          </select>
        </label>
        <label class="block">
          <span class={LABEL}>Tahun</span>
          <select bind:value={tahun} class={FIELD}>
            {#each tahunPilihan as t (t)}<option value={t}>{t}</option>{/each}
          </select>
        </label>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <label class="block">
        <span class={LABEL}>Tanggal input</span>
        <input
          type="date"
          name="tanggal_input"
          value={editing ? (editing.tanggal_input ?? '') : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })}
          class={FIELD}
        />
      </label>
      <label class="block">
        <span class={LABEL}>Tanggal kegiatan (mulai)</span>
        <input type="date" name="tanggal_kegiatan" bind:value={tanggalKegiatan} onchange={ikutiTanggal} class={FIELD} />
      </label>
      <label class="block">
        <span class={LABEL}>Sampai tanggal (selesai)</span>
        <input type="date" name="tanggal_selesai" bind:value={tanggalSelesai} min={tanggalKegiatan || undefined} class={FIELD} />
      </label>
    </div>

    {#if !editing}
      <label class="block">
        <span class={LABEL}>Keterangan <span class="text-subtle">(opsional)</span></span>
        <textarea name="keterangan" class={TEXTAREA}></textarea>
      </label>
    {:else}
      <p class="text-[12px] text-muted-foreground">
        Rincian truk kegiatan ini ikut pindah ke kapal dan bulan yang baru.
      </p>
    {/if}

    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (modalOpen = false)} class={BTN_SOFT}>Batal</button>
      <button type="submit" disabled={saving} class={BTN_PRIMARY}>
        {saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Simpan Data Kapal'}
      </button>
    </div>
  </form>
</FormModal>
