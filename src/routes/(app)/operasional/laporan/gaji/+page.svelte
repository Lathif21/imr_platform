<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Printer from 'lucide-svelte/icons/printer';
  import { goto } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import FormModal from '$lib/components/FormModal.svelte';
  import { withFeedback } from '$lib/form-feedback';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, ton } from '$lib/operasional/kegiatan';
  import { BTN_ICON, BTN_PRIMARY, BTN_SOFT, FIELD, LABEL, TEXTAREA, rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';
  import type { BarisHonor } from '$lib/server/gaji';

  let { data }: { data: PageData } = $props();

  let editing = $state<BarisHonor | null>(null);
  let open = $state(false);
  let saving = $state(false);

  const q = $derived(`entitas=${encodeURIComponent(data.opEntity?.code ?? '')}&bulan=${data.periode.bulan}&tahun=${data.periode.tahun}`);
  const namaBulan = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`);
  const rp = (v: number) => (v ? new Intl.NumberFormat('id-ID').format(v) : '');
  const ketik = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const d = el.value.replace(/\D/g, '');
    el.value = d === '' ? '' : new Intl.NumberFormat('id-ID').format(Number(d));
  };

  function pilih(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    const url = new URL(page.url);
    if (v) url.searchParams.set('karyawan', v);
    else url.searchParams.delete('karyawan');
    goto(url, { keepFocus: true, noScroll: true });
  }

  const total = (rows: { gaji_total: number; pph: number; gaji_bersih: number }[]) =>
    rows.reduce((a, r) => ({ kotor: a.kotor + r.gaji_total, pph: a.pph + r.pph, bersih: a.bersih + r.gaji_bersih }), { kotor: 0, pph: 0, bersih: 0 });
  const totalRingkas = $derived(
    data.ringkas.reduce((a, r) => ({ kotor: a.kotor + r.gaji_kotor, pph: a.pph + r.pph, bersih: a.bersih + r.gaji_bersih }), { kotor: 0, pph: 0, bersih: 0 })
  );

  const simpanTelly = withFeedback({ failTitle: 'Gaji telly gagal disimpan', onSuccess: () => (open = false), onPending: (p) => (saving = p) });
  const simpanAdmin = withFeedback({ failTitle: 'Gaji gagal disimpan', onPending: (p) => (saving = p) });

  const TH = 'font-medium py-2.5 px-3';
</script>

<svelte:head><title>Laporan Gaji · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <div>
      <a href="/operasional/laporan?{q}" class="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"><ArrowLeft size={13} /> Laporan</a>
      <h1 class="text-[15px] font-semibold text-foreground mt-1">Laporan Gaji Karyawan</h1>
      <p class="text-[12px] text-muted-foreground mt-0.5">Honor telly per kegiatan dan gaji admin bulanan · {namaBulan}</p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
      <label class="sr-only" for="pilih-karyawan">Karyawan</label>
      <select id="pilih-karyawan" value={data.dipilih?.id ?? ''} onchange={pilih} class="h-[30px] px-2 bg-background border border-border rounded-md text-[12px] text-foreground focus:outline-none focus:border-primary max-w-[240px]">
        <option value="">Rekap semua karyawan</option>
        {#each data.daftar as k (k.id)}<option value={k.id}>{k.nama}{k.jabatan ? ` · ${k.jabatan}` : ''}</option>{/each}
      </select>
      {#if data.dipilih}
        <a href="/cetak/operasional/gaji?{q}&karyawan={data.dipilih.id}" target="_blank" rel="noopener" class={BTN_SOFT}><Printer size={14} /> Slip Gaji</a>
      {/if}
    </div>
  </div>

  {#if !data.dipilih}
    <div class="bg-card border border-border rounded-lg overflow-x-auto">
      <table class="w-full min-w-[760px] text-[12px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="{TH} text-left">Karyawan</th>
            <th class="{TH} text-left">Jabatan</th>
            <th class="{TH} text-right">Aktivitas</th>
            <th class="{TH} text-right">Tonase (MT)</th>
            <th class="{TH} text-right">Gaji Kotor</th>
            <th class="{TH} text-right">Potongan PPh</th>
            <th class="{TH} text-right">Gaji Bersih</th>
            <th class="{TH} text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each data.ringkas as r (r.id)}
            <tr class="border-b border-border/40 hover:bg-muted/40">
              <td class="py-2.5 px-3 font-semibold text-foreground">{r.nama}</td>
              <td class="py-2.5 px-3">{r.jabatan ?? '—'}</td>
              <td class="py-2.5 px-3 text-right num">{r.admin ? 'Bulanan' : r.aktivitas}</td>
              <td class="py-2.5 px-3 text-right num">{r.admin ? '—' : ton(r.tonase)}</td>
              <td class="py-2.5 px-3 text-right num">{rupiah(r.gaji_kotor)}</td>
              <td class="py-2.5 px-3 text-right num text-destructive">{rupiah(r.pph)}</td>
              <td class="py-2.5 px-3 text-right num font-semibold text-foreground">{rupiah(r.gaji_bersih)}</td>
              <td class="py-2 px-3 text-right"><a href="?{q}&karyawan={r.id}" class="text-[12px] text-primary hover:underline">Rincian</a></td>
            </tr>
          {:else}
            <tr><td colspan="8" class="py-10 text-center text-muted-foreground">Belum ada honor telly atau gaji admin untuk {namaBulan}. Pilih karyawan admin untuk mengisi gaji bulanannya.</td></tr>
          {/each}
        </tbody>
        {#if data.ringkas.length}
          <tfoot>
            <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
              <td class="py-2.5 px-3" colspan="4">TOTAL KESELURUHAN</td>
              <td class="py-2.5 px-3 text-right num">{rupiah(totalRingkas.kotor)}</td>
              <td class="py-2.5 px-3 text-right num">{rupiah(totalRingkas.pph)}</td>
              <td class="py-2.5 px-3 text-right num">{rupiah(totalRingkas.bersih)}</td>
              <td></td>
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>
  {:else if data.dipilih.admin && data.admin}
    <form method="POST" action="?/simpanAdmin" use:enhance={simpanAdmin} class="bg-card border border-border rounded-lg p-4 space-y-3 max-w-[640px]">
      <input type="hidden" name="entity_id" value={data.opEntity?.id} />
      <input type="hidden" name="karyawan_id" value={data.dipilih.id} />
      <input type="hidden" name="bulan" value={data.periode.bulan} />
      <input type="hidden" name="tahun" value={data.periode.tahun} />
      <h2 class="text-[13px] font-semibold text-foreground">Gaji Admin Bulanan · {data.dipilih.nama}</h2>
      <p class="text-[12px] text-muted-foreground">
        {data.admin.id ? 'Tercatat untuk' : 'Belum ada gaji tercatat untuk'} {namaBulan}. Satu baris per bulan.
      </p>
      <fieldset disabled={!data.canWrite} class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="block"><span class={LABEL}>Gaji kotor (Rp)</span><input name="gaji_total" value={rp(data.admin.gaji_total)} oninput={ketik} inputmode="numeric" class="{FIELD} text-right num" /></label>
        <label class="block"><span class={LABEL}>Potongan PPh (Rp)</span><input name="pph" value={rp(data.admin.pph)} oninput={ketik} inputmode="numeric" class="{FIELD} text-right num" /></label>
        <label class="block sm:col-span-2"><span class={LABEL}>Keterangan</span><textarea name="keterangan" value={data.admin.keterangan ?? 'Gaji Admin Bulanan'} class={TEXTAREA}></textarea></label>
      </fieldset>
      <div class="flex items-center justify-between">
        <span class="text-[12px] text-muted-foreground">Gaji bersih tersimpan: <span class="num font-semibold text-foreground">{rupiah(data.admin.gaji_bersih)}</span></span>
        {#if data.canWrite}<button type="submit" disabled={saving} class={BTN_PRIMARY}>{saving ? 'Menyimpan…' : 'Simpan Gaji'}</button>{/if}
      </div>
    </form>
  {:else}
    {@const t = total(data.honor)}
    <div class="bg-card border border-border rounded-lg overflow-x-auto">
      <table class="w-full min-w-[900px] text-[12px]">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="{TH} text-left">Kegiatan</th>
            <th class="{TH} text-left">Rute</th>
            <th class="{TH} text-right">Tonase (MT)</th>
            <th class="{TH} text-right">Gaji /Ton</th>
            <th class="{TH} text-right">Gaji Total</th>
            <th class="{TH} text-right">PPh</th>
            <th class="{TH} text-right">Gaji Bersih</th>
            <th class="{TH} text-left">Keterangan</th>
            {#if data.canWrite}<th class="{TH} text-right">Aksi</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each data.honor as h (h.id)}
            <tr class="border-b border-border/40 hover:bg-muted/40">
              <td class="py-2.5 px-3 font-semibold text-foreground">{h.kegiatan}</td>
              <td class="py-2.5 px-3">{h.rute ?? '-'}</td>
              <td class="py-2.5 px-3 text-right num">{ton(h.tonase)}</td>
              <td class="py-2.5 px-3 text-right num">{rupiah(h.gaji)}</td>
              <td class="py-2.5 px-3 text-right num">{rupiah(h.gaji_total)}</td>
              <td class="py-2.5 px-3 text-right num text-destructive">{rupiah(h.pph)}</td>
              <td class="py-2.5 px-3 text-right num font-semibold text-foreground">{rupiah(h.gaji_bersih)}</td>
              <td class="py-2.5 px-3 text-muted-foreground">{h.keterangan ?? '—'}</td>
              {#if data.canWrite}
                <td class="py-2 px-3 text-right">
                  <button type="button" onclick={() => ((editing = h), (open = true))} class={BTN_ICON} aria-label="Ubah gaji {h.kegiatan}"><Pencil size={14} /></button>
                </td>
              {/if}
            </tr>
          {:else}
            <tr><td colspan="9" class="py-10 text-center text-muted-foreground">{data.dipilih.nama} tidak bertugas sebagai telly pada kegiatan {namaBulan}.</td></tr>
          {/each}
        </tbody>
        {#if data.honor.length}
          <tfoot>
            <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
              <td class="py-2.5 px-3" colspan="4">TOTAL KESELURUHAN</td>
              <td class="py-2.5 px-3 text-right num">{rupiah(t.kotor)}</td>
              <td class="py-2.5 px-3 text-right num">{rupiah(t.pph)}</td>
              <td class="py-2.5 px-3 text-right num">{rupiah(t.bersih)}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>
    <p class="text-[11px] text-muted-foreground">Tonase berasal dari daftar truk kegiatan; ubah lewat Lengkapi Data atau Rincian Pembayaran Truk.</p>
  {/if}
</div>

<FormModal bind:open title="Ubah Gaji Telly">
  {#if editing}
    <form method="POST" action="?/simpanTelly" use:enhance={simpanTelly} class="space-y-3">
      <input type="hidden" name="id" value={editing.id} />
      <p class="text-[12px] text-muted-foreground">{editing.kegiatan} · {ton(editing.tonase)} MT</p>
      <div class="grid grid-cols-2 gap-3">
        <label class="block"><span class={LABEL}>Gaji per ton (Rp)</span><input name="gaji" value={rp(editing.gaji)} oninput={ketik} inputmode="numeric" class="{FIELD} text-right num" /></label>
        <label class="block"><span class={LABEL}>Potongan PPh (Rp)</span><input name="pph" value={rp(editing.pph)} oninput={ketik} inputmode="numeric" class="{FIELD} text-right num" /></label>
      </div>
      <label class="block"><span class={LABEL}>Keterangan</span><textarea name="keterangan" value={editing.keterangan ?? ''} class={TEXTAREA}></textarea></label>
      <div class="flex justify-end gap-2">
        <button type="button" onclick={() => (open = false)} class={BTN_SOFT}>Batal</button>
        <button type="submit" disabled={saving} class={BTN_PRIMARY}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
      </div>
    </form>
  {/if}
</FormModal>
