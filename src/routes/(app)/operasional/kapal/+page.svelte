<script lang="ts">
  import ImporExcel from '$lib/operasional/ImporExcel.svelte';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Plus from 'lucide-svelte/icons/plus';
  import Search from 'lucide-svelte/icons/search';
  import Ship from 'lucide-svelte/icons/ship';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import { enhance } from '$app/forms';
  import FormModal from '$lib/components/FormModal.svelte';
  import { withFeedback } from '$lib/form-feedback';
  import { BTN_ICON, BTN_ICON_DANGER, BTN_PRIMARY, BTN_SOFT, FIELD, LABEL, matches } from '$lib/operasional/ui';
  import type { PageData } from './$types';
  import type { KapalRow } from './+page.server';

  let { data }: { data: PageData } = $props();

  let query = $state('');
  let modalOpen = $state(false);
  let editing = $state<KapalRow | null>(null);
  let saving = $state(false);

  const rows = $derived(data.kapal.filter((row) => matches(query, row.nama_kapal, row.pemilik_kapal)));

  function openCreate() {
    editing = null;
    modalOpen = true;
  }

  function openEdit(row: KapalRow) {
    editing = row;
    modalOpen = true;
  }

  const save = withFeedback({
    failTitle: 'Kapal gagal disimpan',
    onSuccess: () => (modalOpen = false),
    onPending: (pending) => (saving = pending)
  });

  /** Apa saja yang ikut terhapus, dalam kalimat — sama seperti peringatan Laravel. */
  function consequence(row: KapalRow): string {
    if (row.jumlah_pencairan > 0) {
      return `Kapal ini punya ${row.jumlah_pencairan} pencairan, jadi penghapusan akan ditolak. Selesaikan pencairannya lebih dulu.`;
    }
    const parts: string[] = [];
    if (row.jumlah_kegiatan > 0) parts.push(`${row.jumlah_kegiatan} detail kegiatan kapal`);
    if (row.jumlah_transaksi > 0) parts.push(`${row.jumlah_transaksi} rincian pembayaran truk`);
    return parts.length
      ? `Seluruh ${parts.join(' dan ')} pada kapal ini, beserta honor telly-nya, akan ikut terhapus dan tidak bisa dikembalikan.`
      : 'Data yang dihapus tidak bisa dikembalikan.';
  }

  function remove(row: KapalRow) {
    return withFeedback({
      failTitle: 'Kapal gagal dihapus',
      confirm: {
        title: 'Hapus data kapal & seluruh rinciannya?',
        message: `Kapal ${row.nama_kapal} akan dihapus.`,
        consequence: consequence(row),
        confirmLabel: 'Ya, hapus',
        tone: 'danger'
      }
    });
  }
</script>

<svelte:head><title>Kapal · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-[17px] font-semibold text-foreground">Kapal</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">Master data kapal · {data.kapal.length} kapal</p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <div class="relative">
        <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
        <input
          bind:value={query}
          type="search"
          placeholder="Cari nama kapal atau pemilik…"
          aria-label="Cari kapal"
          class="{FIELD} pl-8 w-[240px]"
        />
      </div>
      {#if data.canWrite}
        <ImporExcel jenis="kapal" label="Kapal" />
        <button type="button" onclick={openCreate} class={BTN_PRIMARY}>
          <Plus size={14} /> Tambah Kapal
        </button>
      {/if}
    </div>
  </div>

  <div class="bg-card border border-border rounded-lg overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="text-left font-semibold py-2.5 px-4">Nama Kapal</th>
            <th class="text-left font-semibold py-2.5 px-4">Perusahaan Pemilik Kapal</th>
            <th class="text-right font-semibold py-2.5 px-4 w-[110px]">Kegiatan</th>
            <th class="text-right font-semibold py-2.5 px-4 w-[110px]">Truk</th>
            {#if data.canWrite}<th class="text-right font-semibold py-2.5 px-4 w-[96px]">Aksi</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr class="border-b border-border/40 last:border-b-0 hover:bg-muted/40">
              <td class="py-2.5 px-4 font-semibold text-foreground">
                <span class="inline-flex items-center gap-2">
                  <Ship size={13} class="text-muted-foreground" />
                  {row.nama_kapal}
                </span>
              </td>
              <td class="py-2.5 px-4 text-foreground">
                {#if row.pemilik_kapal}{row.pemilik_kapal}{:else}<span class="text-subtle">—</span>{/if}
              </td>
              <td class="py-2.5 px-4 text-right num">{row.jumlah_kegiatan}</td>
              <td class="py-2.5 px-4 text-right num">{row.jumlah_transaksi}</td>
              {#if data.canWrite}
                <td class="py-2 px-4">
                  <div class="flex justify-end gap-1">
                    <button
                      type="button"
                      onclick={() => openEdit(row)}
                      class={BTN_ICON}
                      aria-label="Ubah {row.nama_kapal}"
                      title="Ubah"
                    >
                      <Pencil size={14} />
                    </button>
                    <form method="POST" action="?/hapus" use:enhance={remove(row)}>
                      <input type="hidden" name="id" value={row.id} />
                      <button
                        type="submit"
                        class={BTN_ICON_DANGER}
                        aria-label="Hapus {row.nama_kapal}"
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
                  Tidak ada kapal yang cocok dengan "{query}".
                {:else}
                  Belum ada data kapal.{data.canWrite ? ' Klik "Tambah Kapal" untuk menambahkan.' : ''}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<FormModal bind:open={modalOpen} title={editing ? 'Ubah Kapal' : 'Tambah Kapal'}>
  <form method="POST" action="?/simpan" use:enhance={save} class="space-y-4">
    <input type="hidden" name="entity_id" value={data.opEntity?.id} />
    {#if editing}<input type="hidden" name="id" value={editing.id} />{/if}

    <label class="block">
      <span class={LABEL}>Nama kapal</span>
      <input
        name="nama_kapal"
        value={editing?.nama_kapal ?? ''}
        maxlength="255"
        placeholder="cth. KM Sinar Jaya"
        class={FIELD}
      />
    </label>

    <label class="block">
      <span class={LABEL}>Perusahaan pemilik kapal <span class="text-subtle">(opsional)</span></span>
      <input
        name="pemilik_kapal"
        value={editing?.pemilik_kapal ?? ''}
        maxlength="255"
        placeholder="cth. PT Pelayaran Nusantara"
        class={FIELD}
      />
    </label>

    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (modalOpen = false)} class={BTN_SOFT}>Batal</button>
      <button type="submit" disabled={saving} class={BTN_PRIMARY}>
        {saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Simpan Kapal'}
      </button>
    </div>
  </form>
</FormModal>
