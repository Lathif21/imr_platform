<script lang="ts">
  import Download from 'lucide-svelte/icons/download';
  import FileText from 'lucide-svelte/icons/file-text';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Plus from 'lucide-svelte/icons/plus';
  import Search from 'lucide-svelte/icons/search';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import { enhance } from '$app/forms';
  import FormModal from '$lib/components/FormModal.svelte';
  import { withFeedback } from '$lib/form-feedback';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, bulanIni, rentangTanggal, ton } from '$lib/operasional/kegiatan';
  import type { Approval, Departemen } from '$lib/operasional/pencairan';
  import { BTN_ICON, BTN_ICON_DANGER, BTN_PRIMARY, BTN_SOFT, FIELD, LABEL, TEXTAREA, matches, rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';
  import type { PencairanRow } from './+page.server';

  let { data }: { data: PageData } = $props();

  let query = $state('');
  let kapalFilter = $state('');
  let saving = $state(false);

  let invoiceOpen = $state(false);
  let editing = $state<PencairanRow | null>(null);
  let nominal = $state('');
  let pajak = $state('');

  let approvalOpen = $state(false);
  let approvalRow = $state<PencairanRow | null>(null);
  let approvalDept = $state<Departemen>('Jetty');
  const approvalCurrent = $derived(approvalRow?.approvals.find((a) => a.departemen === approvalDept) ?? null);

  const rows = $derived(
    data.pencairan.filter(
      (r) => (kapalFilter === '' || String(r.kapal_id) === kapalFilter) && matches(query, r.nomor_invoice, r.nama_kapal)
    )
  );
  const kapalBulanIni = $derived([...new Map(data.pencairan.map((r) => [r.kapal_id, r.nama_kapal])).entries()]);
  const tahunPilihan = $derived.by(() => {
    const now = bulanIni().tahun;
    return Array.from({ length: 5 }, (_, i) => now - 3 + i);
  });

  const rp = (n: number) => (n ? new Intl.NumberFormat('id-ID').format(n) : '');
  const formatRp = (value: string) => {
    const d = value.replace(/\D/g, '');
    return d === '' ? '' : new Intl.NumberFormat('id-ID').format(Number(d));
  };

  /** Days since the BA (revenue row) was issued — Laravel's "H+n / 14" badge. */
  function hariSejakBap(row: PencairanRow): number {
    const start = new Date(row.laporan?.created_at ?? row.created_at).getTime();
    return Math.max(1, Math.floor((Date.now() - start) / 86_400_000));
  }

  const CHIP: Record<Approval['status'], string> = {
    Approved: 'bg-positive/10 text-positive border-positive/30',
    Rejected: 'bg-destructive/10 text-destructive border-destructive/30',
    Pending: 'bg-warning/10 text-warning border-warning/30'
  };

  function openCreate() {
    editing = null;
    nominal = '';
    pajak = '';
    invoiceOpen = true;
  }

  function openEdit(row: PencairanRow) {
    editing = row;
    nominal = rp(row.nominal_invoice);
    pajak = rp(row.besaran_pajak);
    invoiceOpen = true;
  }

  function openApproval(row: PencairanRow, departemen: Departemen) {
    approvalRow = row;
    approvalDept = departemen;
    approvalOpen = true;
  }

  const entityQuery = $derived(data.opEntity ? `entitas=${encodeURIComponent(data.opEntity.code)}` : '');

  const tarik = withFeedback({ failTitle: 'Tarik invoice dari Laporan Pendapatan', onPending: (p) => (saving = p) });

  const saveInvoice = withFeedback({
    failTitle: 'Invoice gagal disimpan',
    onSuccess: () => (invoiceOpen = false),
    onPending: (p) => (saving = p)
  });

  const saveApproval = withFeedback({
    failTitle: 'Persetujuan gagal disimpan',
    onSuccess: () => (approvalOpen = false),
    onPending: (p) => (saving = p)
  });

  function remove(row: PencairanRow) {
    return withFeedback({
      failTitle: 'Invoice gagal dihapus',
      confirm: {
        title: 'Hapus invoice pencairan?',
        message: `Invoice ${row.nomor_invoice} (${row.nama_kapal}) beserta riwayat persetujuannya akan dihapus.`,
        consequence:
          'Baris invoice yang sama di Laporan Pendapatan ikut terhapus bila belum dibayar (belum LUNAS dan belum punya tanggal bayar). Tidak bisa dikembalikan.',
        confirmLabel: 'Ya, hapus',
        tone: 'danger'
      }
    });
  }
</script>

<svelte:head><title>Pencairan · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-[17px] font-semibold text-foreground">Pencairan</h1>
      <p class="text-[13px] text-muted-foreground mt-0.5">
        Persetujuan bertahap Jetty → Gudang → Accounting · {NAMA_BULAN[data.periode.bulan - 1]}
        {data.periode.tahun} · {data.pencairan.length} invoice
      </p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
      <label class="sr-only" for="filter-kapal">Kapal</label>
      <select id="filter-kapal" bind:value={kapalFilter} class="h-[30px] px-2 bg-background border border-border rounded-md text-[13px] text-foreground focus:outline-none focus:border-primary max-w-[180px]">
        <option value="">Semua kapal</option>
        {#each kapalBulanIni as [id, nama] (id)}<option value={String(id)}>{nama}</option>{/each}
      </select>
      <div class="relative">
        <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
        <input bind:value={query} type="search" placeholder="Cari nomor invoice…" aria-label="Cari invoice" class="{FIELD} pl-8 w-[190px]" />
      </div>
      {#if data.canWrite}
        <form method="POST" action="?/tarik" use:enhance={tarik}>
          <input type="hidden" name="entity_id" value={data.opEntity?.id} />
          <input type="hidden" name="bulan" value={data.periode.bulan} />
          <input type="hidden" name="tahun" value={data.periode.tahun} />
          <button type="submit" disabled={saving} class={BTN_SOFT} title="Buat pencairan untuk setiap invoice Laporan Pendapatan bulan ini yang belum punya">
            <Download size={14} /> Tarik dari Laporan Pendapatan
          </button>
        </form>
        <button type="button" onclick={openCreate} class={BTN_PRIMARY}><Plus size={14} /> Buat Invoice</button>
      {/if}
    </div>
  </div>

  <div class="bg-card border border-border rounded-lg overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[960px] text-[13px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="text-left font-semibold py-2.5 px-3">Nomor Invoice</th>
            <th class="text-left font-semibold py-2.5 px-3">Kapal / Periode</th>
            <th class="text-right font-semibold py-2.5 px-3">Nominal / Pajak</th>
            <th class="text-center font-semibold py-2.5 px-3">Approval Departemen</th>
            <th class="text-center font-semibold py-2.5 px-3">Status Final</th>
            {#if data.canWrite}<th class="text-right font-semibold py-2.5 px-3 w-[90px]">Aksi</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr class="border-b border-border/40 last:border-b-0 hover:bg-muted/40 align-top">
              <td class="py-2.5 px-3">
                <div class="font-semibold text-foreground num">{row.nomor_invoice}</div>
                {#if row.status !== 'Approved'}
                  {@const hari = hariSejakBap(row)}
                  <span
                    class="inline-block mt-1 px-1.5 py-0.5 rounded text-[11px] {hari > 14 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}"
                    title="Hari kalender sejak BAP penagihan diterbitkan ({rentangTanggal(row.laporan?.created_at ?? row.created_at, null)}); target 14 hari kerja"
                  >
                    BAP H+{hari}
                  </span>
                {/if}
              </td>
              <td class="py-2.5 px-3">
                <div class="text-foreground">{row.nama_kapal}</div>
                <div class="text-[12px] text-muted-foreground">Periode {NAMA_BULAN[row.bulan - 1]} {row.tahun}</div>
              </td>
              <td class="py-2.5 px-3 text-right whitespace-nowrap">
                <div class="num font-semibold text-foreground">{rupiah(row.nominal_invoice)}</div>
                <div class="num text-[12px] text-destructive">Pajak {rupiah(row.besaran_pajak)}</div>
              </td>
              <td class="py-2.5 px-3">
                <div class="flex justify-center gap-2">
                  {#each row.approvals as a (a.departemen)}
                    <div class="flex flex-col items-center gap-0.5">
                      <button
                        type="button"
                        disabled={!data.canWrite}
                        onclick={() => openApproval(row, a.departemen)}
                        class="px-2 py-0.5 rounded-md border text-[12px] font-medium {CHIP[a.status]} enabled:hover:brightness-95 disabled:cursor-default"
                        title={data.canWrite ? `Ubah persetujuan ${a.departemen}` : a.keterangan ?? ''}
                      >
                        {a.departemen}
                      </button>
                      <span class="text-[11px] text-muted-foreground">{a.status}</span>
                      {#if a.status === 'Approved' && a.tanggal_ttd}
                        <span class="text-[11px] text-subtle num">{rentangTanggal(a.tanggal_ttd, null)}</span>
                      {/if}
                    </div>
                  {/each}
                </div>
              </td>
              <td class="py-2.5 px-3 text-center">
                {#if row.status === 'Approved'}
                  <a
                    href="/operasional/pendapatan?{entityQuery}&bulan={row.bulan}&tahun={row.tahun}&status=PROSES%20PAYMENT"
                    class="inline-block px-2 py-0.5 rounded-full bg-positive/10 text-positive text-[12px] font-medium hover:bg-positive/20"
                    title="Buka Laporan Pendapatan, posisi Proses Payment"
                  >
                    Approved · Proses Payment →
                  </a>
                {:else if row.status === 'Rejected'}
                  <span class="inline-block px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[12px] font-medium">Rejected</span>
                {:else}
                  <span class="inline-block px-2 py-0.5 rounded-full bg-warning/10 text-warning text-[12px] font-medium">Pending</span>
                {/if}
              </td>
              {#if data.canWrite}
                <td class="py-2 px-3">
                  <div class="flex justify-end gap-1">
                    <button type="button" onclick={() => openEdit(row)} class={BTN_ICON} aria-label="Ubah invoice {row.nomor_invoice}" title="Ubah"><Pencil size={14} /></button>
                    <form method="POST" action="?/hapus" use:enhance={remove(row)}>
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" class={BTN_ICON_DANGER} aria-label="Hapus invoice {row.nomor_invoice}" title="Hapus"><Trash2 size={14} /></button>
                    </form>
                  </div>
                </td>
              {/if}
            </tr>
          {:else}
            <tr>
              <td colspan="6" class="py-10 px-4 text-center text-[13px] text-muted-foreground">
                {#if query || kapalFilter}Tidak ada invoice yang cocok.{:else}Belum ada invoice pencairan untuk {NAMA_BULAN[data.periode.bulan - 1]} {data.periode.tahun}.{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<FormModal bind:open={invoiceOpen} title={editing ? 'Ubah Data Invoice' : 'Buat Tagihan Invoice Baru'} wide>
  <form method="POST" action="?/simpan" use:enhance={saveInvoice} class="space-y-4">
    <input type="hidden" name="entity_id" value={data.opEntity?.id} />
    {#if editing}<input type="hidden" name="id" value={editing.id} />{/if}

    <div class="grid grid-cols-1 sm:grid-cols-[1fr_150px_100px] gap-3">
      <label class="block">
        <span class={LABEL}>Kapal</span>
        <select name="kapal_id" value={editing ? String(editing.kapal_id) : ''} class={FIELD}>
          <option value="">— Pilih kapal —</option>
          {#each data.daftarKapal as k (k.id)}<option value={String(k.id)}>{k.nama}</option>{/each}
        </select>
      </label>
      <label class="block">
        <span class={LABEL}>Bulan</span>
        <select name="bulan" value={String(editing?.bulan ?? data.periode.bulan)} class={FIELD}>
          {#each NAMA_BULAN as nama, i (nama)}<option value={String(i + 1)}>{nama}</option>{/each}
        </select>
      </label>
      <label class="block">
        <span class={LABEL}>Tahun</span>
        <select name="tahun" value={String(editing?.tahun ?? data.periode.tahun)} class={FIELD}>
          {#each tahunPilihan as t (t)}<option value={String(t)}>{t}</option>{/each}
        </select>
      </label>
    </div>

    <label class="block">
      <span class={LABEL}>Nomor invoice</span>
      <input name="nomor_invoice" value={editing?.nomor_invoice ?? ''} maxlength="255" placeholder="cth. 12/PT.IMR-XII/2026" class={FIELD} />
    </label>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block">
        <span class={LABEL}>Nominal invoice (Rp, sebelum pajak)</span>
        <input name="nominal_invoice" inputmode="numeric" value={nominal} oninput={(e) => (nominal = formatRp(e.currentTarget.value))} placeholder="0" class="{FIELD} text-right num" />
      </label>
      <label class="block">
        <span class={LABEL}>Besaran pajak (Rp)</span>
        <input name="besaran_pajak" inputmode="numeric" value={pajak} oninput={(e) => (pajak = formatRp(e.currentTarget.value))} placeholder="0" class="{FIELD} text-right num" />
      </label>
    </div>
    <p class="text-[12px] text-muted-foreground">
      Disinkronkan ke Laporan Pendapatan dengan nomor invoice yang sama: total = nominal, net tagihan = nominal − pajak.
      {editing ? 'Status persetujuan tidak berubah.' : 'Ketiga persetujuan departemen dimulai dari Pending.'}
    </p>

    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (invoiceOpen = false)} class={BTN_SOFT}>Batal</button>
      <button type="submit" disabled={saving} class={BTN_PRIMARY}>{saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Simpan Invoice'}</button>
    </div>
  </form>
</FormModal>

<FormModal bind:open={approvalOpen} title="Persetujuan {approvalDept}" wide>
  {#if approvalRow}
    {@const l = approvalRow.laporan}
    <div class="rounded-lg border border-border bg-muted/30 p-3 mb-4 space-y-2">
      <div class="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <FileText size={14} class="text-muted-foreground" /> Preview Berita Acara · {approvalRow.nomor_invoice}
        {#if l}
          <a href="/cetak/operasional/ba/{l.id}?{entityQuery}" target="_blank" rel="noopener" class="ml-auto text-[12px] font-medium text-primary hover:underline">
            Lihat / cetak BA →
          </a>
        {/if}
      </div>
      {#if l}
        <dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[13px]">
          <div><dt class="text-[11px] text-muted-foreground">Kegiatan / Kapal</dt><dd class="text-foreground truncate">{l.kegiatan || '—'}</dd></div>
          <div><dt class="text-[11px] text-muted-foreground">Party</dt><dd class="text-foreground num">{ton(l.party_kg)} KG</dd></div>
          <div><dt class="text-[11px] text-muted-foreground">Lokasi / Rute</dt><dd class="text-foreground truncate">{l.lokasi || '—'}</dd></div>
          <div><dt class="text-[11px] text-muted-foreground">No. Faktur Pajak</dt><dd class="text-foreground num">{l.no_faktur_pajak || '—'}</dd></div>
          <div><dt class="text-[11px] text-muted-foreground">No. STO / SPO</dt><dd class="text-foreground num">{l.no_sto_spo || '—'}</dd></div>
          <div><dt class="text-[11px] text-muted-foreground">Pajak</dt><dd class="text-destructive num">{ton(l.tarif_pajak)}% · {rupiah(l.pajak)}</dd></div>
        </dl>
        <div class="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2">
          <span class="text-[12px] text-muted-foreground">Total net tagihan · gross {rupiah(l.total)}</span>
          <span class="text-[15px] font-semibold text-foreground num">{rupiah(l.net_tagihan || l.total)}</span>
        </div>
      {:else}
        <p class="text-[13px] text-muted-foreground">Belum ada baris Laporan Pendapatan untuk invoice ini.</p>
      {/if}
    </div>

    <form method="POST" action="?/setujui" use:enhance={saveApproval} class="space-y-4">
      <input type="hidden" name="id" value={approvalRow.id} />
      <input type="hidden" name="departemen" value={approvalDept} />
      {#key `${approvalRow.id}-${approvalDept}`}
        <fieldset>
          <legend class={LABEL}>Status persetujuan {approvalDept}</legend>
          <div class="flex gap-2">
            {#each ['Approved', 'Pending', 'Rejected'] as s (s)}
              <label class="flex-1 cursor-pointer">
                <input type="radio" name="status" value={s} checked={approvalCurrent?.status === s} class="peer sr-only" />
                <span class="block text-center h-[34px] leading-[32px] rounded-lg border border-border text-[13px] text-muted-foreground peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                  {s}
                </span>
              </label>
            {/each}
          </div>
        </fieldset>
        <div class="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
          <label class="block">
            <span class={LABEL}>Tanggal tanda tangan</span>
            <input type="date" name="tanggal_ttd" value={approvalCurrent?.tanggal_ttd ?? ''} class={FIELD} />
            <span class="block text-[12px] text-subtle mt-1">Kosong = hari ini.</span>
          </label>
          <label class="block">
            <span class={LABEL}>Keterangan <span class="text-subtle">(opsional)</span></span>
            <textarea name="keterangan" value={approvalCurrent?.keterangan ?? ''} class={TEXTAREA}></textarea>
          </label>
        </div>
      {/key}
      <div class="flex justify-end gap-2 pt-1">
        <button type="button" onclick={() => (approvalOpen = false)} class={BTN_SOFT}>Batal</button>
        <button type="submit" disabled={saving} class={BTN_PRIMARY}>{saving ? 'Menyimpan…' : 'Simpan Persetujuan'}</button>
      </div>
    </form>
  {/if}
</FormModal>
