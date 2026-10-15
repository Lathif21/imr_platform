<script lang="ts">
  /**
   * Lampiran — dokumen asli sebagai bukti, for one record.
   *
   * `bagian`: a section on the page (Lengkapi Data, Laporan P&L).
   * `tombol`: a 📎 button with the count, opening the same list in a dialog
   * (a row in Pengeluaran, Pendapatan).
   *
   * Upload goes browser → storage through a presigned URL from /lampiran,
   * then /lampiran records it (see that route). Several files at once; each
   * shows its own progress, and every failure is listed, not just the first.
   */
  import Download from 'lucide-svelte/icons/download';
  import FileText from 'lucide-svelte/icons/file-text';
  import ImageIcon from 'lucide-svelte/icons/image';
  import Paperclip from 'lucide-svelte/icons/paperclip';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Upload from 'lucide-svelte/icons/upload';
  import FormModal from '$lib/components/FormModal.svelte';
  import { confirmDialog, notify } from '$lib/feedback.svelte';
  import { ACCEPT, tolakBerkas, ukuranTeks, type JenisLampiran, type Lampiran } from '$lib/lampiran';
  import { BTN_ICON, BTN_ICON_DANGER, BTN_SOFT } from '$lib/operasional/ui';

  let {
    jenis,
    ref,
    canWrite,
    /**
     * Deleting can close before adding does: P&L evidence stays once the
     * period is approved (lampiran_periode_delete). Defaults to canWrite.
     */
    bolehHapus,
    /** Count known from the page load, shown before the list is fetched. */
    jumlah = 0,
    mode = 'bagian',
    /** What is being attached to, for the dialog title: "Invoice 1/PT.IMR-XII/2026". */
    judul = 'Lampiran'
  }: {
    jenis: JenisLampiran;
    ref: string | number;
    canWrite: boolean;
    bolehHapus?: boolean;
    jumlah?: number;
    mode?: 'bagian' | 'tombol';
    judul?: string;
  } = $props();

  type Unggahan = { nama: string; persen: number; galat?: string };

  let daftar = $state<Lampiran[] | null>(null);
  let unggahan = $state<Unggahan[]>([]);
  let terbuka = $state(false);
  let seret = $state(false);
  let input = $state<HTMLInputElement>();
  // svelte-ignore state_referenced_locally
  let hitung = $state(jumlah);

  const href = (l: Lampiran, unduh = false) => `/lampiran/${jenis}/${l.id}${unduh ? '?unduh' : ''}`;
  const sibuk = $derived(unggahan.some((u) => !u.galat && u.persen < 100));

  async function muat() {
    const res = await fetch(`/lampiran?jenis=${jenis}&ref=${encodeURIComponent(String(ref))}`);
    if (!res.ok) {
      daftar = [];
      return;
    }
    daftar = (await res.json()).lampiran as Lampiran[];
    hitung = daftar.length;
  }

  $effect(() => {
    if (mode === 'bagian' || terbuka) void muat();
  });

  async function kirimJson(body: Record<string, unknown>) {
    const res = await fetch('/lampiran', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jenis, ref, ...body })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? 'Gagal menghubungi server.');
    return data;
  }

  /** PUT with progress — fetch() cannot report upload progress. */
  function put(url: string, file: File, tipe: string, onProgress: (p: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('content-type', tipe);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 95));
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`ditolak penyimpanan (${xhr.status})`)));
      xhr.onerror = () => reject(new Error('koneksi ke penyimpanan terputus'));
      xhr.send(file);
    });
  }

  async function unggah(files: FileList | File[]) {
    const list = [...files];
    if (list.length === 0) return;
    const galat: string[] = [];
    const awal = unggahan.length;
    unggahan = [...unggahan, ...list.map((f) => ({ nama: f.name, persen: 0 }))];

    // One at a time: a phone on a weak connection finishes files instead of starving all of them.
    for (const [i, file] of list.entries()) {
      const u = unggahan[awal + i];
      const alasan = tolakBerkas(file.name, file.size);
      if (alasan) {
        u.galat = alasan;
        galat.push(alasan);
        continue;
      }
      try {
        const { kunci, url, tipe } = await kirimJson({ langkah: 'minta', nama: file.name, ukuran: file.size });
        await put(url, file, tipe, (p) => (u.persen = p));
        await kirimJson({ langkah: 'simpan', kunci, nama: file.name });
        u.persen = 100;
      } catch (e) {
        u.galat = `${file.name}: ${(e as Error).message}`;
        galat.push(u.galat);
      }
    }

    await muat();
    unggahan = unggahan.filter((x) => x.galat);
    if (galat.length) {
      await notify('error', {
        title: galat.length === list.length ? 'Lampiran gagal diunggah' : 'Sebagian lampiran gagal diunggah',
        details: galat
      });
      unggahan = [];
    }
    if (input) input.value = '';
  }

  async function hapus(l: Lampiran) {
    const ok = await confirmDialog({
      title: 'Hapus lampiran?',
      message: `${l.nama_file} akan dihapus dari data ini.`,
      consequence: 'Berkas aslinya ikut terhapus dari penyimpanan dan tidak bisa dikembalikan.',
      confirmLabel: 'Ya, hapus',
      tone: 'danger'
    });
    if (!ok) return;
    const res = await fetch(`/lampiran/${jenis}/${l.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      await notify('error', { title: 'Lampiran gagal dihapus', message: data.message ?? 'Coba lagi sebentar.' });
      return;
    }
    await muat();
  }

  function jatuh(e: DragEvent) {
    e.preventDefault();
    seret = false;
    if (e.dataTransfer?.files.length) void unggah(e.dataTransfer.files);
  }

  const tanggal = (iso: string) =>
    new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
</script>

{#snippet isi()}
  <div class="space-y-3">
    {#if daftar === null}
      <p class="text-[15px] text-muted-foreground">Memuat lampiran…</p>
    {:else if daftar.length === 0 && unggahan.length === 0}
      <p class="text-[15px] text-muted-foreground">
        Belum ada dokumen.{canWrite ? ' Unggah foto atau scan dokumen asli sebagai bukti.' : ''}
      </p>
    {:else}
      <ul class="divide-y divide-border/60 border border-border rounded-lg bg-background">
        {#each daftar as l (l.id)}
          <li class="flex items-center gap-3 px-3 py-2">
            {#if l.tipe.startsWith('image/')}
              <ImageIcon size={18} class="shrink-0 text-muted-foreground" />
            {:else}
              <FileText size={18} class="shrink-0 text-muted-foreground" />
            {/if}
            <div class="min-w-0 flex-1">
              <a href={href(l)} target="_blank" rel="noopener" class="block text-[15px] font-medium text-foreground hover:text-primary truncate" title={l.nama_file}>
                {l.nama_file}
              </a>
              <p class="text-[14px] text-muted-foreground">
                {ukuranTeks(l.ukuran)} · {tanggal(l.created_at)}{l.pengunggah ? ` · ${l.pengunggah}` : ''}
              </p>
            </div>
            <a href={href(l, true)} class={BTN_ICON} title="Unduh" aria-label="Unduh {l.nama_file}"><Download size={15} /></a>
            {#if bolehHapus ?? canWrite}
              <button type="button" onclick={() => hapus(l)} class={BTN_ICON_DANGER} title="Hapus" aria-label="Hapus lampiran {l.nama_file}">
                <Trash2 size={15} />
              </button>
            {/if}
          </li>
        {/each}
        {#each unggahan as u, i (i)}
          <li class="px-3 py-2">
            <div class="flex items-center justify-between gap-3 text-[15px]">
              <span class="truncate {u.galat ? 'text-destructive' : 'text-foreground'}">{u.galat ?? u.nama}</span>
              {#if !u.galat}<span class="num text-muted-foreground shrink-0">{u.persen}%</span>{/if}
            </div>
            {#if !u.galat}
              <div class="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                <div class="h-full bg-primary transition-[width]" style="width: {u.persen}%"></div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if canWrite}
      <label
        class="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-5 text-center cursor-pointer transition-colors
               {seret ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60 hover:bg-muted/40'}"
        ondragover={(e) => {
          e.preventDefault();
          seret = true;
        }}
        ondragleave={() => (seret = false)}
        ondrop={jatuh}
      >
        <Upload size={20} class="text-muted-foreground" />
        <span class="text-[16px] font-medium text-foreground">
          {sibuk ? 'Mengunggah…' : 'Seret berkas ke sini, atau klik untuk memilih'}
        </span>
        <span class="text-[14px] text-muted-foreground">PDF, foto (JPG/PNG/HEIC), Excel, Word, CSV · maks. 20 MB per berkas</span>
        <input
          bind:this={input}
          type="file"
          multiple
          accept={ACCEPT}
          class="sr-only"
          aria-label="Pilih berkas lampiran"
          disabled={sibuk}
          onchange={(e) => e.currentTarget.files && unggah(e.currentTarget.files)}
        />
      </label>
    {/if}
  </div>
{/snippet}

{#if mode === 'bagian'}
  <section class="bg-card border border-border rounded-lg overflow-hidden">
    <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
      <h2 class="text-[16px] font-semibold text-foreground inline-flex items-center gap-2">
        <Paperclip size={17} class="text-muted-foreground" /> Dokumen Bukti
        {#if hitung > 0}<span class="text-[14px] font-normal text-muted-foreground">· {hitung} berkas</span>{/if}
      </h2>
    </div>
    <div class="p-4">{@render isi()}</div>
  </section>
{:else}
  <button
    type="button"
    onclick={() => (terbuka = true)}
    class="{hitung > 0 ? BTN_SOFT : BTN_ICON} {hitung > 0 ? 'h-[28px] px-2 text-[14px] gap-1' : ''}"
    title={hitung > 0 ? `${hitung} dokumen bukti` : canWrite ? 'Lampirkan dokumen bukti' : 'Belum ada dokumen bukti'}
    aria-label="Lampiran {judul}"
  >
    <Paperclip size={17} />
    {#if hitung > 0}<span class="num">{hitung}</span>{/if}
  </button>
  <FormModal bind:open={terbuka} title="Dokumen Bukti · {judul}" wide>
    {@render isi()}
    <div class="flex justify-end pt-4">
      <button type="button" onclick={() => (terbuka = false)} class={BTN_SOFT}>Tutup</button>
    </div>
  </FormModal>
{/if}
