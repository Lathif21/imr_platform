<script lang="ts">
  import ImporExcel from '$lib/operasional/ImporExcel.svelte';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Plus from 'lucide-svelte/icons/plus';
  import Search from 'lucide-svelte/icons/search';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import X from 'lucide-svelte/icons/x';
  import { enhance } from '$app/forms';
  import FormModal from '$lib/components/FormModal.svelte';
  import { withFeedback } from '$lib/form-feedback';
  import {
    BTN_ICON,
    BTN_ICON_DANGER,
    BTN_PRIMARY,
    BTN_SOFT,
    FIELD,
    LABEL,
    matches
  } from '$lib/operasional/ui';
  import type { PageData } from './$types';
  import type { KendaraanRow } from './+page.server';

  let { data }: { data: PageData } = $props();

  let query = $state('');
  let modalOpen = $state(false);
  let editing = $state<KendaraanRow | null>(null);
  let saving = $state(false);

  const rows = $derived(
    data.kendaraan.filter((row) => matches(query, row.nopol, row.nama_pemilik, row.npwp))
  );
  const entityQuery = $derived(`?entitas=${encodeURIComponent(data.opEntity?.code ?? '')}`);
  const filterName = $derived(
    data.daftarPemilik.find((p) => p.id === data.filterPemilik)?.nama_pemilik ?? null
  );

  function openCreate() {
    editing = null;
    modalOpen = true;
  }

  function openEdit(row: KendaraanRow) {
    editing = row;
    modalOpen = true;
  }

  const save = withFeedback({
    failTitle: 'Kendaraan gagal disimpan',
    onSuccess: () => (modalOpen = false),
    onPending: (pending) => (saving = pending)
  });

  function remove(row: KendaraanRow) {
    const used = row.jumlah_transaksi + row.jumlah_muatan > 0;
    return withFeedback({
      failTitle: 'Kendaraan gagal dihapus',
      confirm: {
        title: 'Hapus kendaraan?',
        message: `Kendaraan ${row.nopol} milik ${row.nama_pemilik} akan dihapus.`,
        consequence: used
          ? 'Kendaraan ini sudah dipakai di transaksi atau rincian muatan kapal, jadi penghapusan akan ditolak.'
          : 'Data yang dihapus tidak bisa dikembalikan.',
        confirmLabel: 'Ya, hapus',
        tone: 'danger'
      }
    });
  }
</script>

<svelte:head><title>Kendaraan · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-[17px] font-semibold text-foreground">Kendaraan</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">
        Truk rekanan · {data.kendaraan.length} kendaraan
      </p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <div class="relative">
        <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
        <input
          bind:value={query}
          type="search"
          placeholder="Cari nopol, pemilik, NPWP…"
          aria-label="Cari kendaraan"
          class="{FIELD} pl-8 w-[220px]"
        />
      </div>
      <ImporExcel jenis="kendaraan" label="Kendaraan" bolehImpor={data.canWrite} />
      {#if data.canWrite}
        <button
          type="button"
          onclick={openCreate}
          disabled={data.daftarPemilik.length === 0}
          title={data.daftarPemilik.length === 0 ? 'Tambahkan pemilik lebih dulu' : undefined}
          class={BTN_PRIMARY}
        >
          <Plus size={14} /> Tambah Kendaraan
        </button>
      {/if}
    </div>
  </div>

  {#if filterName}
    <div class="flex items-center gap-2 text-[13px]">
      <span class="text-muted-foreground">Pemilik:</span>
      <span
        class="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-0.5 rounded-md bg-primary/10 text-primary font-medium"
      >
        {filterName}
        <a
          href="/operasional/kendaraan{entityQuery}"
          aria-label="Hapus filter pemilik"
          class="p-0.5 rounded hover:bg-primary/15"
        >
          <X size={12} />
        </a>
      </span>
    </div>
  {/if}

  <div class="bg-card border border-border rounded-lg overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[680px] text-[13px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="text-left font-semibold py-2.5 px-4 w-[160px]">Nomor Polisi</th>
            <th class="text-left font-semibold py-2.5 px-4">Pemilik Kendaraan</th>
            <th class="text-left font-semibold py-2.5 px-4 w-[200px]">NPWP</th>
            <th class="text-right font-semibold py-2.5 px-4 w-[110px]">Transaksi</th>
            {#if data.canWrite}<th class="text-right font-semibold py-2.5 px-4 w-[96px]">Aksi</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr class="border-b border-border/40 last:border-b-0 hover:bg-muted/40">
              <td class="py-2.5 px-4 font-semibold text-foreground tracking-wide">{row.nopol}</td>
              <td class="py-2.5 px-4 text-foreground">{row.nama_pemilik}</td>
              <td class="py-2.5 px-4 text-muted-foreground tabular-nums">
                {#if row.npwp}{row.npwp}{:else}<span class="text-subtle">—</span>{/if}
              </td>
              <td class="py-2.5 px-4 text-right num">{row.jumlah_transaksi}</td>
              {#if data.canWrite}
                <td class="py-2 px-4">
                  <div class="flex justify-end gap-1">
                    <button
                      type="button"
                      onclick={() => openEdit(row)}
                      class={BTN_ICON}
                      aria-label="Ubah {row.nopol}"
                      title="Ubah"
                    >
                      <Pencil size={14} />
                    </button>
                    <form method="POST" action="?/hapus" use:enhance={remove(row)}>
                      <input type="hidden" name="id" value={row.id} />
                      <button
                        type="submit"
                        class={BTN_ICON_DANGER}
                        aria-label="Hapus {row.nopol}"
                        title="Hapus"
                      >
                        <Trash2 size={14} />
                      </button>
                    </form>
                  </div>
                </td>
              {/if}
            </tr>
          {:else}
            <tr>
              <td colspan="5" class="py-10 px-4 text-center text-[13px] text-muted-foreground">
                {#if query}
                  Tidak ada kendaraan yang cocok dengan "{query}".
                {:else if data.daftarPemilik.length === 0}
                  Belum ada pemilik kendaraan. Tambahkan pemilik di menu Pemilik (Data Master) lebih dulu.
                {:else}
                  Belum ada kendaraan{filterName ? ` milik ${filterName}` : ''}.
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<FormModal bind:open={modalOpen} title={editing ? 'Ubah Kendaraan' : 'Tambah Kendaraan'}>
  <form method="POST" action="?/simpan" use:enhance={save} class="space-y-4">
    <input type="hidden" name="entity_id" value={data.opEntity?.id} />
    {#if editing}<input type="hidden" name="id" value={editing.id} />{/if}

    <label class="block">
      <span class={LABEL}>Nomor polisi</span>
      <input
        name="nopol"
        value={editing?.nopol ?? ''}
        maxlength="255"
        placeholder="cth. BP 1234 XY"
        class="{FIELD} uppercase"
      />
    </label>

    <label class="block">
      <span class={LABEL}>Pemilik kendaraan</span>
      <select name="pemilik_id" class={FIELD}>
        <option value="" selected={!editing && !data.filterPemilik}>— Pilih pemilik —</option>
        {#each data.daftarPemilik as pemilik (pemilik.id)}
          <option
            value={pemilik.id}
            selected={(editing?.pemilik_id ?? data.filterPemilik) === pemilik.id}
          >
            {pemilik.nama_pemilik}
          </option>
        {/each}
      </select>
    </label>

    <label class="block">
      <span class={LABEL}>NPWP <span class="text-subtle">(opsional)</span></span>
      <input
        name="npwp"
        value={editing?.npwp ?? ''}
        maxlength="255"
        placeholder="cth. 00.000.000.0-000.000"
        class="{FIELD} tabular-nums"
      />
    </label>

    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (modalOpen = false)} class={BTN_SOFT}>Batal</button>
      <button type="submit" disabled={saving} class={BTN_PRIMARY}>
        {saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Simpan Kendaraan'}
      </button>
    </div>
  </form>
</FormModal>
