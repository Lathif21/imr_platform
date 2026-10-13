<script lang="ts">
  import Pencil from 'lucide-svelte/icons/pencil';
  import Plus from 'lucide-svelte/icons/plus';
  import Search from 'lucide-svelte/icons/search';
  import Trash2 from 'lucide-svelte/icons/trash-2';
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
    matches,
    rupiah
  } from '$lib/operasional/ui';
  import type { PageData } from './$types';
  import type { PemilikRow } from './+page.server';

  let { data }: { data: PageData } = $props();

  let query = $state('');
  let modalOpen = $state(false);
  let editing = $state<PemilikRow | null>(null);
  let saving = $state(false);

  const rows = $derived(data.pemilik.filter((row) => matches(query, row.nama_pemilik)));
  const entityQuery = $derived(`?entitas=${encodeURIComponent(data.opEntity?.code ?? '')}`);

  function openCreate() {
    editing = null;
    modalOpen = true;
  }

  function openEdit(row: PemilikRow) {
    editing = row;
    modalOpen = true;
  }

  const save = withFeedback({
    failTitle: 'Pemilik gagal disimpan',
    onSuccess: () => (modalOpen = false),
    onPending: (pending) => (saving = pending)
  });

  function remove(row: PemilikRow) {
    return withFeedback({
      failTitle: 'Pemilik gagal dihapus',
      confirm: {
        title: 'Hapus pemilik?',
        message: `${row.nama_pemilik} akan dihapus dari daftar pemilik kendaraan.`,
        consequence:
          row.jumlah_kendaraan > 0
            ? `Pemilik ini masih punya ${row.jumlah_kendaraan} kendaraan, jadi penghapusan akan ditolak.`
            : 'Data yang dihapus tidak bisa dikembalikan.',
        confirmLabel: 'Ya, hapus',
        tone: 'danger'
      }
    });
  }
</script>

<svelte:head><title>Pemilik · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-[17px] font-semibold text-foreground">Pemilik Kendaraan</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">
        Rekanan pemilik truk · {data.pemilik.length} pemilik
      </p>
    </div>
    <div class="flex items-center gap-2">
      <div class="relative">
        <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
        <input
          bind:value={query}
          type="search"
          placeholder="Cari pemilik…"
          aria-label="Cari pemilik"
          class="{FIELD} pl-8 w-[200px]"
        />
      </div>
      {#if data.canWrite}
        <button type="button" onclick={openCreate} class={BTN_PRIMARY}>
          <Plus size={14} /> Tambah Pemilik
        </button>
      {/if}
    </div>
  </div>

  <div class="bg-card border border-border rounded-lg overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[620px] text-[13px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="text-left font-semibold py-2.5 px-4">Nama Pemilik Kendaraan</th>
            <th class="text-right font-semibold py-2.5 px-4 w-[140px]">Total Kendaraan</th>
            <th
              class="text-right font-medium py-2.5 px-4 w-[200px]"
              title="Jumlah ongkos angkut (tonase × tarif) yang dibayarkan ke pemilik ini"
            >
              Pendapatan Bruto Rekanan
            </th>
            {#if data.canWrite}<th class="text-right font-semibold py-2.5 px-4 w-[96px]">Aksi</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr class="border-b border-border/40 last:border-b-0 hover:bg-muted/40">
              <td class="py-2.5 px-4 font-medium text-foreground">{row.nama_pemilik}</td>
              <td class="py-2.5 px-4 text-right">
                <a
                  href="/operasional/kendaraan{entityQuery}&pemilik={row.id}"
                  class="text-primary hover:underline"
                  title="Lihat kendaraan pemilik ini"
                >
                  {row.jumlah_kendaraan} unit
                </a>
              </td>
              <td class="py-2.5 px-4 text-right num">{rupiah(row.total_pendapatan_rekanan)}</td>
              {#if data.canWrite}
                <td class="py-2 px-4">
                  <div class="flex justify-end gap-1">
                    <button
                      type="button"
                      onclick={() => openEdit(row)}
                      class={BTN_ICON}
                      aria-label="Ubah {row.nama_pemilik}"
                      title="Ubah"
                    >
                      <Pencil size={14} />
                    </button>
                    <form method="POST" action="?/hapus" use:enhance={remove(row)}>
                      <input type="hidden" name="id" value={row.id} />
                      <button
                        type="submit"
                        class={BTN_ICON_DANGER}
                        aria-label="Hapus {row.nama_pemilik}"
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
              <td colspan="4" class="py-10 px-4 text-center text-[13px] text-muted-foreground">
                {#if query}
                  Tidak ada pemilik yang cocok dengan "{query}".
                {:else}
                  Belum ada pemilik kendaraan untuk {data.opEntity?.code}.
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<FormModal bind:open={modalOpen} title={editing ? 'Ubah Pemilik' : 'Tambah Pemilik'}>
  <form method="POST" action="?/simpan" use:enhance={save} class="space-y-4">
    <input type="hidden" name="entity_id" value={data.opEntity?.id} />
    {#if editing}<input type="hidden" name="id" value={editing.id} />{/if}

    <label class="block">
      <span class={LABEL}>Nama pemilik kendaraan</span>
      <input
        name="nama_pemilik"
        value={editing?.nama_pemilik ?? ''}
        maxlength="255"
        placeholder="cth. H. Ahmad"
        class={FIELD}
      />
    </label>

    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (modalOpen = false)} class={BTN_SOFT}>Batal</button>
      <button type="submit" disabled={saving} class={BTN_PRIMARY}>
        {saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Simpan Pemilik'}
      </button>
    </div>
  </form>
</FormModal>
