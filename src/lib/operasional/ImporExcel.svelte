<script lang="ts">
  /**
   * "Template" and "Unggah Excel" for one kind of data, next to the screen's
   * Tambah button. Upload shows a preview of every row: errors in red (the
   * file must be fixed — nothing is saved while any row is wrong), and rows
   * that match existing data with a choice between the old and the new.
   * Saving is all or nothing (/operasional/impor/[jenis]).
   */
  import Download from 'lucide-svelte/icons/download';
  import FileUp from 'lucide-svelte/icons/file-up';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import FormModal from '$lib/components/FormModal.svelte';
  import { notify } from '$lib/feedback.svelte';
  import type { JenisImpor, PilihanDuplikat, Pratinjau } from '$lib/impor';
  import { BTN_PRIMARY, BTN_SOFT } from './ui';

  let { jenis, label }: { jenis: JenisImpor; label: string } = $props();

  let terbuka = $state(false);
  let berkas = $state<File | null>(null);
  let pratinjau = $state<Pratinjau | null>(null);
  let pilihan = $state<Record<number, PilihanDuplikat>>({});
  let sibuk = $state(false);

  const query = $derived.by(() => {
    const q = new URLSearchParams();
    const entitas = (page.data.opEntity as { code: string } | null | undefined)?.code;
    const periode = page.data.periode as { bulan: number; tahun: number } | undefined;
    if (entitas) q.set('entitas', entitas);
    if (periode) {
      q.set('bulan', String(periode.bulan));
      q.set('tahun', String(periode.tahun));
    }
    return q.toString();
  });

  const galat = $derived(pratinjau ? pratinjau.galatBerkas.length + pratinjau.baris.filter((b) => b.galat.length).length : 0);
  const duplikat = $derived(pratinjau?.baris.filter((b) => b.duplikat) ?? []);
  const perluPilih = $derived(duplikat.filter((b) => b.duplikat!.bisaTimpa));
  const belumDipilih = $derived(perluPilih.filter((b) => !pilihan[b.baris]).length);
  const siap = $derived(!!pratinjau && pratinjau.baris.length > 0 && galat === 0 && belumDipilih === 0);

  function buka() {
    berkas = null;
    pratinjau = null;
    pilihan = {};
    terbuka = true;
  }

  async function kirim(langkah: 'pratinjau' | 'simpan') {
    if (!berkas) return;
    const fd = new FormData();
    fd.set('berkas', berkas);
    fd.set('langkah', langkah);
    fd.set('pilihan', JSON.stringify(pilihan));
    sibuk = true;
    try {
      const res = await fetch(`/operasional/impor/${jenis}?${query}`, { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.pratinjau) pratinjau = body.pratinjau;
        await notify('error', { title: langkah === 'simpan' ? 'Impor gagal' : 'File tidak bisa diperiksa', message: body.message ?? 'Coba lagi sebentar.' });
        return;
      }
      if (langkah === 'pratinjau') {
        pratinjau = body as Pratinjau;
        pilihan = {};
      } else {
        terbuka = false;
        await invalidateAll();
        await notify('success', {
          title: 'Impor berhasil',
          message: `${body.disimpan} ${jenis === 'kegiatan' ? 'kegiatan' : 'baris'} ${label.toLowerCase()} disimpan.`
        });
      }
    } finally {
      sibuk = false;
    }
  }

  function pilihBerkas(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const f = el.files?.[0];
    // Cleared so picking the same (corrected) file again fires change again.
    el.value = '';
    if (!f) return;
    berkas = f;
    void kirim('pratinjau');
  }

  function pilihSemua(p: PilihanDuplikat) {
    pilihan = Object.fromEntries(perluPilih.map((b) => [b.baris, p]));
  }
</script>

<a href="/operasional/impor/{jenis}?{query}" download class={BTN_SOFT} title="Unduh template Excel {label}, isi, lalu unggah kembali">
  <Download size={14} /> Template
</a>
<button type="button" onclick={buka} class={BTN_SOFT} title="Unggah template {label} yang sudah diisi">
  <FileUp size={14} /> Unggah Excel
</button>

<FormModal bind:open={terbuka} title="Impor {label} dari Excel" wide>
  <div class="space-y-4">
    <div class="flex items-center gap-3 flex-wrap">
      <label class="{BTN_PRIMARY} cursor-pointer">
        <FileUp size={14} />
        {berkas ? 'Pilih file lain' : 'Pilih file Excel'}
        <input type="file" accept=".xlsx" class="sr-only" onchange={pilihBerkas} aria-label="File Excel {label}" />
      </label>
      {#if berkas}<span class="text-[13px] text-muted-foreground truncate">{berkas.name}</span>{/if}
      <a href="/operasional/impor/{jenis}?{query}" download class="ml-auto text-[13px] text-primary hover:underline">Unduh template</a>
    </div>

    {#if sibuk && !pratinjau}
      <p class="text-[13px] text-muted-foreground">Memeriksa file…</p>
    {:else if !pratinjau}
      <p class="text-[13px] text-muted-foreground leading-relaxed">
        Gunakan template dari tombol <strong>Template</strong> di layar ini. Setelah file dipilih, setiap baris diperiksa
        dan ditampilkan di sini lebih dulu — belum ada yang disimpan sampai Anda menekan <strong>Simpan</strong>.
      </p>
    {:else}
      {#each pratinjau.galatBerkas as g (g)}
        <p class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{g}</p>
      {/each}

      {#if pratinjau.baris.length}
        <div class="flex items-center gap-x-4 gap-y-1 flex-wrap text-[13px]">
          <span class="text-foreground font-medium">{pratinjau.baris.length} baris</span>
          <span class={galat ? 'text-destructive font-medium' : 'text-positive'}>{galat ? `${galat} baris salah` : 'semua baris benar'}</span>
          {#if duplikat.length}<span class="text-warning font-medium">{duplikat.length} sudah ada di sistem</span>{/if}
          {#if perluPilih.length > 1}
            <span class="ml-auto inline-flex gap-1.5">
              <button type="button" onclick={() => pilihSemua('lama')} class="{BTN_SOFT} h-[28px] px-2.5 text-[12px]">Semua: data lama</button>
              <button type="button" onclick={() => pilihSemua('baru')} class="{BTN_SOFT} h-[28px] px-2.5 text-[12px]">Semua: data baru</button>
            </span>
          {/if}
        </div>

        <div class="max-h-[50vh] overflow-auto border border-border rounded-lg">
          <table class="w-full text-[13px]">
            <thead class="sticky top-0 bg-card">
              <tr class="text-muted-foreground border-b border-border">
                <th class="text-left font-semibold py-2 px-2 w-[56px]">Baris</th>
                {#each pratinjau.kolom as k (k)}<th class="text-left font-semibold py-2 px-2">{k}</th>{/each}
                <th class="text-left font-semibold py-2 px-2 min-w-[240px]">Hasil pemeriksaan</th>
              </tr>
            </thead>
            <tbody>
              {#each pratinjau.baris as b (b.baris)}
                <tr class="border-b border-border/40 align-top {b.galat.length ? 'bg-destructive/5' : b.duplikat ? 'bg-warning/5' : ''}">
                  <td class="py-1.5 px-2 num text-muted-foreground">{b.baris}</td>
                  {#each b.tampil as t, i (i)}<td class="py-1.5 px-2">{t}</td>{/each}
                  <td class="py-1.5 px-2">
                    {#if b.galat.length}
                      <ul class="space-y-0.5 text-destructive">
                        {#each b.galat as g (g)}<li>{g}</li>{/each}
                      </ul>
                    {:else if b.duplikat}
                      <p class="text-warning">{b.duplikat.keterangan}</p>
                      {#if b.duplikat.bisaTimpa}
                        <div class="flex gap-3 mt-1">
                          <label class="inline-flex items-center gap-1.5 cursor-pointer">
                            <input type="radio" name="dup-{b.baris}" value="lama" bind:group={pilihan[b.baris]} class="accent-primary" /> Data lama
                          </label>
                          <label class="inline-flex items-center gap-1.5 cursor-pointer">
                            <input type="radio" name="dup-{b.baris}" value="baru" bind:group={pilihan[b.baris]} class="accent-primary" /> Data baru
                          </label>
                        </div>
                      {/if}
                    {:else if b.ikutBaris}
                      <span class="text-muted-foreground">Truk kegiatan baris {b.ikutBaris}</span>
                    {:else}
                      <span class="text-positive">Siap disimpan</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if galat}
          <p class="text-[13px] text-destructive">Perbaiki baris yang salah di file, simpan, lalu pilih file itu lagi. Tidak ada yang disimpan selama masih ada baris salah.</p>
        {:else if belumDipilih}
          <p class="text-[13px] text-warning">Pilih "Data lama" atau "Data baru" untuk {belumDipilih} baris yang sudah ada.</p>
        {/if}
      {/if}
    {/if}

    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (terbuka = false)} class={BTN_SOFT}>Batal</button>
      <button type="button" onclick={() => kirim('simpan')} disabled={!siap || sibuk} class={BTN_PRIMARY}>
        {sibuk && pratinjau ? 'Menyimpan…' : pratinjau && pratinjau.baris.length ? `Simpan ${pratinjau.baris.length} baris` : 'Simpan'}
      </button>
    </div>
  </div>
</FormModal>
