<script lang="ts">
  import FileDown from 'lucide-svelte/icons/file-down';
  import FileUp from 'lucide-svelte/icons/file-up';
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import { confirmDialog, notify } from '$lib/feedback.svelte';
  import type { SubmitFunction } from '@sveltejs/kit';

  /**
   * Unduh template Excel dan unggah kembali. Komponen tersendiri supaya layar
   * input tidak bertambah panjang; ia hanya menempel di kepala layar.
   *
   * Feedback mengikuti platform (keputusan P-3): konfirmasi lewat
   * confirmDialog, hasil lewat modal notify().
   */
  let { month, entity, editable }: { month: string; entity: string; editable: boolean } = $props();

  const STORAGE_KEY = 'imr-impor-excel';
  let busy = $state(false);
  let input = $state<HTMLInputElement>();

  /**
   * Setelah impor, halaman dimuat ulang penuh: angka di form adalah state
   * lokal yang diisi sekali dari data, jadi memuat ulang adalah cara pasti
   * supaya yang tampil sama dengan yang tersimpan. Pesan suksesnya dititipkan
   * ke sessionStorage dan ditampilkan sesudah reload.
   */
  onMount(() => {
    let pesan: string | null = null;
    try {
      pesan = sessionStorage.getItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* penyimpanan diblokir: pesan dilewati, angkanya tetap benar */
    }
    if (pesan) void notify('success', { title: 'Laporan berhasil diimpor', message: pesan });
  });

  async function pilihFile(event: Event & { currentTarget: HTMLInputElement }) {
    const form = event.currentTarget.form;
    if (!event.currentTarget.files?.length || !form) return;
    const lanjut = await confirmDialog({
      title: 'Impor dari Excel?',
      message: 'Angka dari file akan menggantikan angka pos yang terisi di file.',
      consequence: 'Sel Jumlah yang kosong tidak mengubah pos itu, dan catatan yang kosong tidak menghapus catatan.',
      confirmLabel: 'Impor',
      tone: 'danger'
    });
    if (lanjut) form.requestSubmit();
    else if (input) input.value = '';
  }

  const submit: SubmitFunction = ({ cancel }) => {
    if (!input?.files?.length) {
      cancel();
      return;
    }
    busy = true;
    return async ({ result }) => {
      busy = false;
      if (input) input.value = '';
      if (result.type === 'success') {
        const d = result.data as { imported: number; unchanged: number; skipped: number; fileName: string };
        const pesan =
          (d.imported > 0
            ? `${d.imported} pos diisi dari ${d.fileName}.`
            : `Tidak ada angka yang berbeda di ${d.fileName}.`) +
          (d.unchanged > 0 ? ` ${d.unchanged} pos sama dengan yang tersimpan.` : '') +
          (d.skipped > 0 ? ` ${d.skipped} pos dengan Jumlah kosong tidak diubah.` : '') +
          ' Periksa angkanya, lalu ajukan seperti biasa.';
        try {
          sessionStorage.setItem(STORAGE_KEY, pesan);
        } catch {
          /* lihat onMount */
        }
        location.reload();
      } else {
        const failure = result.type === 'failure' ? (result.data as { message?: string } | undefined) : undefined;
        void notify('error', {
          title: 'Impor Excel gagal',
          message: failure?.message ?? 'Koneksi terputus atau server tidak menjawab. Coba lagi.'
        });
      }
    };
  };
</script>

<div class="flex items-center gap-2 shrink-0">
  <a
    href="/entry/{month}/excel?entitas={encodeURIComponent(entity)}"
    download
    title="Unduh laporan periode ini sebagai Excel, untuk diisi atau diarsipkan"
    class="px-3 py-1.5 rounded-lg bg-card border border-border text-[13px] font-medium
           text-muted-foreground hover:text-foreground hover:bg-muted transition-colors
           flex items-center gap-1.5"
  >
    <FileDown size={12} />
    Unduh Excel
  </a>

  {#if editable}
    <form method="POST" action="?/importExcel" enctype="multipart/form-data" use:enhance={submit}>
      <input type="hidden" name="entitas" value={entity} />
      <label
        title="Isi laporan dari file Excel hasil Unduh Excel"
        class="px-3 py-1.5 rounded-lg bg-card border border-border text-[13px] font-medium
               text-muted-foreground hover:text-foreground hover:bg-muted transition-colors
               flex items-center gap-1.5 cursor-pointer {busy ? 'opacity-60 pointer-events-none' : ''}"
      >
        <FileUp size={12} />
        {busy ? 'Mengimpor…' : 'Unggah Excel'}
        <input
          bind:this={input}
          type="file"
          name="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="sr-only"
          onchange={pilihFile}
        />
      </label>
    </form>
  {/if}
</div>
