<script lang="ts">
  import NotebookPen from 'lucide-svelte/icons/notebook-pen';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Plus from 'lucide-svelte/icons/plus';
  import Search from 'lucide-svelte/icons/search';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import { enhance } from '$app/forms';
  import FormModal from '$lib/components/FormModal.svelte';
  import { withFeedback } from '$lib/form-feedback';
  import { formatDate } from '$lib/format';
  import {
    BTN_ICON,
    BTN_ICON_DANGER,
    BTN_PRIMARY,
    BTN_SOFT,
    FIELD,
    LABEL,
    TEXTAREA,
    matches
  } from '$lib/operasional/ui';
  import type { PageData } from './$types';
  import type { CatatanRow, KaryawanRow, StatusKinerja } from './+page.server';

  let { data }: { data: PageData } = $props();

  let query = $state('');
  let modalOpen = $state(false);
  let editing = $state<KaryawanRow | null>(null);
  let saving = $state(false);

  let catatanOpen = $state(false);
  let catatanFor = $state<KaryawanRow | null>(null);
  let savingCatatan = $state(false);
  let catatanForm = $state<HTMLFormElement | null>(null);

  const rows = $derived(
    data.karyawan.filter((row) =>
      matches(query, row.nama, row.jabatan, row.no_hp, row.ktp, row.npwp)
    )
  );

  const catatanByKaryawan = $derived(
    data.catatan.reduce<Map<number, CatatanRow[]>>((map, row) => {
      map.set(row.karyawan_id, [...(map.get(row.karyawan_id) ?? []), row]);
      return map;
    }, new Map())
  );

  // The open employee's row is re-read from `data` after every save, so the
  // status badge and the list follow what was just added or removed.
  const catatanTarget = $derived(
    catatanFor ? (data.karyawan.find((k) => k.id === catatanFor!.id) ?? catatanFor) : null
  );

  /**
   * HR status, not money: SP is "needs attention" (warning) until it is the
   * last step before dismissal. Tokens only, per the colour rules in app.css.
   */
  const KINERJA_STYLE: Record<StatusKinerja, string> = {
    Normal: 'bg-positive/10 text-positive border-positive/25',
    SP1: 'bg-warning/10 text-warning border-warning/30',
    SP2: 'bg-warning/20 text-warning border-warning/40',
    SP3: 'bg-destructive/10 text-destructive border-destructive/25'
  };

  const JENIS_LABEL: Record<string, string> = {
    catatan: 'Catatan',
    SP1: 'SP1',
    SP2: 'SP2',
    SP3: 'SP3'
  };

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

  function openCreate() {
    editing = null;
    modalOpen = true;
  }

  function openEdit(row: KaryawanRow) {
    editing = row;
    modalOpen = true;
  }

  function openCatatan(row: KaryawanRow) {
    catatanFor = row;
    catatanOpen = true;
  }

  const save = withFeedback({
    failTitle: 'Data karyawan gagal disimpan',
    onSuccess: () => (modalOpen = false),
    onPending: (pending) => (saving = pending)
  });

  function remove(row: KaryawanRow) {
    const used = row.jumlah_transaksi_telly + row.jumlah_gaji_telly > 0;
    return withFeedback({
      failTitle: 'Karyawan gagal dihapus',
      confirm: {
        title: 'Hapus karyawan?',
        message: `${row.nama} akan dihapus beserta seluruh catatan kinerjanya.`,
        consequence: used
          ? 'Karyawan ini masih terkait transaksi atau gaji telly, jadi penghapusan akan ditolak. Ubah statusnya menjadi nonaktif.'
          : 'Data dan riwayat catatan/SP yang dihapus tidak bisa dikembalikan.',
        confirmLabel: 'Ya, hapus',
        tone: 'danger'
      }
    });
  }

  const addCatatan = withFeedback({
    failTitle: 'Catatan gagal disimpan',
    confirm: (form) => {
      const jenis = String(form.get('jenis'));
      if (jenis === 'catatan') return null;
      return {
        title: `Catat ${jenis}?`,
        message: `${jenis} untuk ${catatanTarget?.nama} akan tercatat di riwayat kinerjanya.`,
        consequence:
          'Status kinerja mengikuti SP terberat yang pernah tercatat, dan tidak turun dengan sendirinya.',
        confirmLabel: `Ya, catat ${jenis}`,
        tone: jenis === 'SP3' ? 'danger' : 'primary'
      };
    },
    onSuccess: () => {
      const field = catatanForm?.querySelector<HTMLTextAreaElement>('textarea[name=keterangan]');
      if (field) field.value = '';
    },
    onPending: (pending) => (savingCatatan = pending)
  });

  function removeCatatan(row: CatatanRow) {
    return withFeedback({
      failTitle: 'Catatan gagal dihapus',
      confirm: {
        title: 'Hapus catatan ini?',
        message: `${JENIS_LABEL[row.jenis]} tanggal ${formatDate(row.tanggal)} akan dihapus dari riwayat.`,
        consequence:
          row.jenis === 'catatan'
            ? undefined
            : 'Status kinerja karyawan akan dihitung ulang dari SP yang tersisa.',
        confirmLabel: 'Ya, hapus',
        tone: 'danger'
      }
    });
  }
</script>

<svelte:head><title>Karyawan · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-[17px] font-semibold text-foreground">Karyawan</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">
        {data.karyawan.filter((k) => k.status === 'aktif').length} aktif dari {data.karyawan.length}
        karyawan · tarif gaji diatur di Rekap Gaji
      </p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <div class="relative">
        <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
        <input
          bind:value={query}
          type="search"
          placeholder="Cari nama, jabatan, KTP…"
          aria-label="Cari karyawan"
          class="{FIELD} pl-8 w-[220px]"
        />
      </div>
      {#if data.canWrite}
        <button type="button" onclick={openCreate} class={BTN_PRIMARY}>
          <Plus size={14} /> Tambah Karyawan
        </button>
      {/if}
    </div>
  </div>

  <div class="bg-card border border-border rounded-lg overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[900px] text-[13px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="text-left font-semibold py-2.5 px-4">Karyawan</th>
            <th class="text-left font-semibold py-2.5 px-4 w-[190px]">Kontak</th>
            <th class="text-left font-semibold py-2.5 px-4 w-[190px]">Dokumen</th>
            <th class="text-left font-semibold py-2.5 px-4 w-[110px]">Bergabung</th>
            <th class="text-left font-semibold py-2.5 px-4 w-[90px]">Status</th>
            <th class="text-left font-semibold py-2.5 px-4 w-[90px]">Kinerja</th>
            <th class="text-right font-semibold py-2.5 px-4 w-[120px]">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr
              class="border-b border-border/40 last:border-b-0 hover:bg-muted/40
                     {row.status === 'nonaktif' ? 'opacity-60' : ''}"
            >
              <td class="py-2.5 px-4">
                <p class="font-medium text-foreground">{row.nama}</p>
                <p class="text-[12px] text-muted-foreground">{row.jabatan ?? 'Karyawan'}</p>
              </td>
              <td class="py-2.5 px-4">
                <p class="text-foreground tabular-nums">{row.no_hp ?? '—'}</p>
                {#if row.alamat}
                  <p class="text-[12px] text-muted-foreground truncate max-w-[170px]" title={row.alamat}>
                    {row.alamat}
                  </p>
                {/if}
              </td>
              <td class="py-2.5 px-4 text-[12px] tabular-nums">
                <p><span class="text-subtle">KTP</span> <span class="text-foreground">{row.ktp ?? '—'}</span></p>
                <p><span class="text-subtle">NPWP</span> <span class="text-foreground">{row.npwp ?? '—'}</span></p>
              </td>
              <td class="py-2.5 px-4 text-muted-foreground">{formatDate(row.tanggal_bergabung)}</td>
              <td class="py-2.5 px-4">
                <span
                  class="text-[12px] font-medium {row.status === 'aktif'
                    ? 'text-positive'
                    : 'text-muted-foreground'}"
                >
                  {row.status === 'aktif' ? 'Aktif' : 'Nonaktif'}
                </span>
              </td>
              <td class="py-2.5 px-4">
                <span
                  class="inline-block px-2 py-0.5 rounded-full border text-[12px] font-semibold
                         {KINERJA_STYLE[row.status_kinerja]}"
                >
                  {row.status_kinerja}
                </span>
              </td>
              <td class="py-2 px-4">
                <div class="flex justify-end gap-1">
                  <button
                    type="button"
                    onclick={() => openCatatan(row)}
                    class={BTN_ICON}
                    aria-label="Catatan kinerja {row.nama}"
                    title="Catatan kinerja & SP"
                  >
                    <NotebookPen size={14} />
                  </button>
                  {#if data.canWrite}
                    <button
                      type="button"
                      onclick={() => openEdit(row)}
                      class={BTN_ICON}
                      aria-label="Ubah {row.nama}"
                      title="Ubah"
                    >
                      <Pencil size={14} />
                    </button>
                    <form method="POST" action="?/hapus" use:enhance={remove(row)}>
                      <input type="hidden" name="id" value={row.id} />
                      <button
                        type="submit"
                        class={BTN_ICON_DANGER}
                        aria-label="Hapus {row.nama}"
                        title="Hapus"
                      >
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
                  Tidak ada karyawan yang cocok dengan "{query}".
                {:else}
                  Belum ada karyawan untuk {data.opEntity?.code}.
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- ── tambah / ubah ─────────────────────────────────────────────────── -->
<FormModal bind:open={modalOpen} wide title={editing ? 'Ubah Karyawan' : 'Tambah Karyawan'}>
  <form method="POST" action="?/simpan" use:enhance={save} class="space-y-4">
    <input type="hidden" name="entity_id" value={data.opEntity?.id} />
    {#if editing}<input type="hidden" name="id" value={editing.id} />{/if}

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block">
        <span class={LABEL}>Nama lengkap</span>
        <input name="nama" value={editing?.nama ?? ''} maxlength="255" placeholder="cth. Budi Santoso" class={FIELD} />
      </label>
      <label class="block">
        <span class={LABEL}>Jabatan</span>
        <input
          name="jabatan"
          value={editing?.jabatan ?? ''}
          maxlength="255"
          placeholder="cth. Telly, Supervisor"
          class={FIELD}
        />
      </label>
      <label class="block">
        <span class={LABEL}>No. HP / WhatsApp</span>
        <input
          name="no_hp"
          value={editing?.no_hp ?? ''}
          maxlength="30"
          inputmode="tel"
          placeholder="08xxxxxxxxxx"
          class="{FIELD} tabular-nums"
        />
      </label>
      <label class="block">
        <span class={LABEL}>Tanggal bergabung</span>
        <input type="date" name="tanggal_bergabung" value={editing?.tanggal_bergabung ?? ''} class={FIELD} />
      </label>
      <label class="block">
        <span class={LABEL}>No. KTP</span>
        <input
          name="ktp"
          value={editing?.ktp ?? ''}
          maxlength="255"
          inputmode="numeric"
          placeholder="16 digit"
          class="{FIELD} tabular-nums"
        />
      </label>
      <label class="block">
        <span class={LABEL}>No. NPWP</span>
        <input
          name="npwp"
          value={editing?.npwp ?? ''}
          maxlength="255"
          placeholder="XX.XXX.XXX.X-XXX"
          class="{FIELD} tabular-nums"
        />
      </label>
      <label class="block sm:col-span-2">
        <span class={LABEL}>Alamat</span>
        <textarea name="alamat" placeholder="Alamat lengkap karyawan" class={TEXTAREA}
          >{editing?.alamat ?? ''}</textarea
        >
      </label>
      <label class="block">
        <span class={LABEL}>Status</span>
        <select name="status" class={FIELD}>
          <option value="aktif" selected={(editing?.status ?? 'aktif') === 'aktif'}>Aktif</option>
          <option value="nonaktif" selected={editing?.status === 'nonaktif'}>Nonaktif</option>
        </select>
      </label>
    </div>

    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (modalOpen = false)} class={BTN_SOFT}>Batal</button>
      <button type="submit" disabled={saving} class={BTN_PRIMARY}>
        {saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Simpan Karyawan'}
      </button>
    </div>
  </form>
</FormModal>

<!-- ── catatan kinerja & SP ──────────────────────────────────────────── -->
<FormModal bind:open={catatanOpen} wide title="Catatan Kinerja · {catatanTarget?.nama ?? ''}">
  {#if catatanTarget}
    {@const riwayat = catatanByKaryawan.get(catatanTarget.id) ?? []}
    <div class="space-y-4">
      <div class="flex items-center gap-2 text-[13px]">
        <span class="text-muted-foreground">Status kinerja saat ini:</span>
        <span
          class="inline-block px-2 py-0.5 rounded-full border text-[12px] font-semibold
                 {KINERJA_STYLE[catatanTarget.status_kinerja]}"
        >
          {catatanTarget.status_kinerja}
        </span>
      </div>

      {#if data.canWrite}
        <form
          bind:this={catatanForm}
          method="POST"
          action="?/tambahCatatan"
          use:enhance={addCatatan}
          class="rounded-lg border border-border bg-card p-3 space-y-3"
        >
          <input type="hidden" name="entity_id" value={data.opEntity?.id} />
          <input type="hidden" name="karyawan_id" value={catatanTarget.id} />
          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class={LABEL}>Tanggal</span>
              <input type="date" name="tanggal" value={today} class={FIELD} />
            </label>
            <label class="block">
              <span class={LABEL}>Jenis</span>
              <select name="jenis" class={FIELD}>
                <option value="catatan">Catatan</option>
                <option value="SP1">SP1 — Surat Peringatan 1</option>
                <option value="SP2">SP2 — Surat Peringatan 2</option>
                <option value="SP3">SP3 — Surat Peringatan 3</option>
              </select>
            </label>
          </div>
          <label class="block">
            <span class={LABEL}>Keterangan</span>
            <textarea
              name="keterangan"
              placeholder="Tulis catatan atau detail pelanggaran…"
              class={TEXTAREA}
            ></textarea>
          </label>
          <div class="flex justify-end">
            <button type="submit" disabled={savingCatatan} class={BTN_PRIMARY}>
              {savingCatatan ? 'Menyimpan…' : 'Simpan Catatan'}
            </button>
          </div>
        </form>
      {/if}

      <div>
        <p class="text-[12px] font-medium text-muted-foreground mb-2">Riwayat</p>
        {#if riwayat.length === 0}
          <p class="text-[13px] text-subtle py-3">Karyawan ini belum memiliki riwayat catatan atau SP.</p>
        {:else}
          <ul class="space-y-2 max-h-[40vh] overflow-y-auto">
            {#each riwayat as item (item.id)}
              <li class="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
                <span
                  class="shrink-0 mt-0.5 px-2 py-0.5 rounded-full border text-[11px] font-semibold
                         {item.jenis === 'catatan'
                    ? 'bg-muted text-muted-foreground border-border'
                    : KINERJA_STYLE[item.jenis]}"
                >
                  {JENIS_LABEL[item.jenis]}
                </span>
                <div class="flex-1 min-w-0">
                  <p class="text-[12px] text-muted-foreground">{formatDate(item.tanggal)}</p>
                  <p class="text-[13px] text-foreground leading-relaxed whitespace-pre-line">
                    {item.keterangan ?? '—'}
                  </p>
                </div>
                {#if data.canWrite}
                  <form method="POST" action="?/hapusCatatan" use:enhance={removeCatatan(item)}>
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" class={BTN_ICON_DANGER} aria-label="Hapus catatan" title="Hapus">
                      <Trash2 size={13} />
                    </button>
                  </form>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
</FormModal>
