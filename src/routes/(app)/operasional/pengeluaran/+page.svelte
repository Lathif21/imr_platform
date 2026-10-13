<script lang="ts">
  import Pencil from 'lucide-svelte/icons/pencil';
  import Plus from 'lucide-svelte/icons/plus';
  import Printer from 'lucide-svelte/icons/printer';
  import Search from 'lucide-svelte/icons/search';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Lampiran from '$lib/components/Lampiran.svelte';
  import { enhance } from '$app/forms';
  import FormModal from '$lib/components/FormModal.svelte';
  import { withFeedback } from '$lib/form-feedback';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, rentangTanggal } from '$lib/operasional/kegiatan';
  import { BTN_ICON, BTN_ICON_DANGER, BTN_PRIMARY, BTN_SOFT, FIELD, LABEL, TEXTAREA, matches, rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';
  import type { PengeluaranRow } from './+page.server';

  let { data }: { data: PageData } = $props();

  const JENIS_BARU = '__baru__';

  let query = $state('');
  let modalOpen = $state(false);
  let editing = $state<PengeluaranRow | null>(null);
  let saving = $state(false);
  let jenisPilihan = $state('');
  let jumlah = $state('');

  const rows = $derived(
    data.pengeluaran.filter((r) => matches(query, r.jenis, r.nama_kegiatan, r.penerima, r.keterangan))
  );
  const total = $derived(data.pengeluaran.reduce((n, r) => n + r.jumlah, 0));

  /** A date inside the month being viewed: today if it is this month, else the 1st. */
  function tanggalAwal(): string {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const prefix = `${data.periode.tahun}-${String(data.periode.bulan).padStart(2, '0')}`;
    return today.startsWith(prefix) ? today : `${prefix}-01`;
  }

  const rp = (n: number) => (n ? new Intl.NumberFormat('id-ID').format(n) : '');

  function openCreate() {
    editing = null;
    jenisPilihan = '';
    jumlah = '';
    modalOpen = true;
  }

  function openEdit(row: PengeluaranRow) {
    editing = row;
    jenisPilihan = data.daftarJenis.includes(row.jenis) ? row.jenis : JENIS_BARU;
    jumlah = rp(row.jumlah);
    modalOpen = true;
  }

  const save = withFeedback({
    failTitle: 'Pengeluaran gagal disimpan',
    onSuccess: () => (modalOpen = false),
    onPending: (pending) => (saving = pending)
  });

  function remove(row: PengeluaranRow) {
    return withFeedback({
      failTitle: 'Pengeluaran gagal dihapus',
      confirm: {
        title: 'Hapus pengeluaran?',
        message: `${row.jenis}${row.nama_kegiatan ? ` — ${row.nama_kegiatan}` : ''} sebesar ${rupiah(row.jumlah)} akan dihapus.`,
        consequence: 'Data yang dihapus tidak bisa dikembalikan.',
        confirmLabel: 'Ya, hapus',
        tone: 'danger'
      }
    });
  }
</script>

<svelte:head><title>Pengeluaran · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-[17px] font-semibold text-foreground">Pengeluaran</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">
        {NAMA_BULAN[data.periode.bulan - 1]}
        {data.periode.tahun} · {data.pengeluaran.length} transaksi · total {rupiah(total)}
      </p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
      <div class="relative">
        <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
        <input bind:value={query} type="search" placeholder="Cari jenis, nama, penerima…" aria-label="Cari pengeluaran" class="{FIELD} pl-8 w-[220px]" />
      </div>
      <a
        href="/cetak/operasional/pengeluaran?entitas={encodeURIComponent(data.opEntity?.code ?? '')}&bulan={data.periode.bulan}&tahun={data.periode.tahun}"
        target="_blank"
        rel="noopener"
        class={BTN_SOFT}
      >
        <Printer size={14} /> Cetak
      </a>
      {#if data.canWrite}
        <button type="button" onclick={openCreate} class={BTN_PRIMARY}><Plus size={14} /> Tambah Pengeluaran</button>
      {/if}
    </div>
  </div>

  <div class="bg-card border border-border rounded-lg overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[860px] text-[13px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="text-center font-semibold py-2.5 px-3 w-[44px]">No</th>
            <th class="text-left font-semibold py-2.5 px-3">Tanggal</th>
            <th class="text-left font-semibold py-2.5 px-3">Jenis Pengeluaran</th>
            <th class="text-left font-semibold py-2.5 px-3">Nama Pengeluaran / Kegiatan</th>
            <th class="text-right font-semibold py-2.5 px-3">Jumlah</th>
            <th class="text-left font-semibold py-2.5 px-3">Penerima</th>
            <th class="text-left font-semibold py-2.5 px-3">Keterangan</th>
            <th class="text-right font-semibold py-2.5 px-3 w-[120px]">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row, i (row.id)}
            <tr class="border-b border-border/40 last:border-b-0 hover:bg-muted/40">
              <td class="py-2.5 px-3 text-center text-muted-foreground num">{i + 1}</td>
              <td class="py-2.5 px-3 whitespace-nowrap num">{rentangTanggal(row.tanggal, null)}</td>
              <td class="py-2.5 px-3 font-medium text-foreground">{row.jenis}</td>
              <td class="py-2.5 px-3">{row.nama_kegiatan ?? '—'}</td>
              <td class="py-2.5 px-3 text-right num whitespace-nowrap font-semibold text-foreground">{rupiah(row.jumlah)}</td>
              <td class="py-2.5 px-3">{row.penerima ?? '—'}</td>
              <td class="py-2.5 px-3 text-muted-foreground max-w-[220px] truncate" title={row.keterangan ?? ''}>{row.keterangan ?? '—'}</td>
              <td class="py-2 px-3">
                <div class="flex justify-end items-center gap-1">
                  <Lampiran mode="tombol" jenis="pengeluaran" ref={row.id} canWrite={data.canWrite} jumlah={data.lampiran[row.id] ?? 0} judul="Pengeluaran {row.jenis}" />
                  {#if data.canWrite}
                    <button type="button" onclick={() => openEdit(row)} class={BTN_ICON} aria-label="Ubah pengeluaran {row.jenis}" title="Ubah"><Pencil size={14} /></button>
                    <form method="POST" action="?/hapus" use:enhance={remove(row)}>
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" class={BTN_ICON_DANGER} aria-label="Hapus pengeluaran {row.jenis}" title="Hapus"><Trash2 size={14} /></button>
                    </form>
                  {/if}
                </div>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="8" class="py-10 px-4 text-center text-[13px] text-muted-foreground">
                {#if query}Tidak ada pengeluaran yang cocok dengan "{query}".{:else}Belum ada pengeluaran untuk {NAMA_BULAN[data.periode.bulan - 1]} {data.periode.tahun}.{/if}
              </td>
            </tr>
          {/each}
        </tbody>
        {#if data.pengeluaran.length > 0}
          <tfoot>
            <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
              <td class="py-2.5 px-3" colspan="4">TOTAL KESELURUHAN {NAMA_BULAN[data.periode.bulan - 1].toUpperCase()} {data.periode.tahun}</td>
              <td class="py-2.5 px-3 text-right num whitespace-nowrap">{rupiah(total)}</td>
              <td colspan="3"></td>
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>
  </div>
</div>

<FormModal bind:open={modalOpen} title={editing ? 'Ubah Pengeluaran' : 'Tambah Pengeluaran'} wide>
  <form method="POST" action="?/simpan" use:enhance={save} class="space-y-4">
    <input type="hidden" name="entity_id" value={data.opEntity?.id} />
    {#if editing}<input type="hidden" name="id" value={editing.id} />{/if}

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block">
        <span class={LABEL}>Tanggal</span>
        <input type="date" name="tanggal" value={editing?.tanggal ?? tanggalAwal()} class={FIELD} />
      </label>
      <label class="block">
        <span class={LABEL}>Penerima <span class="text-subtle">(opsional)</span></span>
        <input name="penerima" list="daftar-penerima" value={editing?.penerima ?? ''} maxlength="255" autocomplete="off" placeholder="Pilih karyawan atau ketik nama" class={FIELD} />
      </label>
    </div>

    <div class="block">
      <label class={LABEL} for="jenis-pilihan">Jenis pengeluaran</label>
      <div class="flex gap-2">
        <select id="jenis-pilihan" bind:value={jenisPilihan} class={FIELD}>
          <option value="">— Pilih jenis pengeluaran —</option>
          {#each data.daftarJenis as j (j)}<option value={j}>{j}</option>{/each}
          <option value={JENIS_BARU}>+ Jenis pengeluaran baru…</option>
        </select>
        {#if jenisPilihan === JENIS_BARU}
          <input name="jenis" value={editing && !data.daftarJenis.includes(editing.jenis) ? editing.jenis : ''} maxlength="255" placeholder="Ketik jenis baru" aria-label="Jenis pengeluaran baru" class={FIELD} />
        {:else}
          <input type="hidden" name="jenis" value={jenisPilihan} />
        {/if}
      </div>
      {#if jenisPilihan === JENIS_BARU}
        <span class="block text-[12px] text-subtle mt-1">
          Jenis baru masuk "Pengeluaran lain-lain" di laporan keuangan sampai dipetakan di portal keuangan.
        </span>
      {/if}
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block">
        <span class={LABEL}>Nama pengeluaran <span class="text-subtle">(opsional)</span></span>
        <input name="nama_kegiatan" value={editing?.nama_kegiatan ?? ''} maxlength="255" class={FIELD} />
      </label>
      <label class="block">
        <span class={LABEL}>Jumlah (Rp)</span>
        <input
          name="jumlah"
          inputmode="numeric"
          value={jumlah}
          oninput={(e) => {
            const d = e.currentTarget.value.replace(/\D/g, '');
            jumlah = d === '' ? '' : new Intl.NumberFormat('id-ID').format(Number(d));
          }}
          placeholder="0"
          class="{FIELD} text-right num"
        />
      </label>
    </div>

    <label class="block">
      <span class={LABEL}>Keterangan <span class="text-subtle">(opsional)</span></span>
      <textarea name="keterangan" value={editing?.keterangan ?? ''} class={TEXTAREA}></textarea>
    </label>

    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (modalOpen = false)} class={BTN_SOFT}>Batal</button>
      <button type="submit" disabled={saving} class={BTN_PRIMARY}>{saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Simpan Pengeluaran'}</button>
    </div>
  </form>
</FormModal>

<datalist id="daftar-penerima">
  {#each data.daftarPenerima as k (k.nama)}<option value={k.nama}>{k.jabatan ?? ''}</option>{/each}
</datalist>
