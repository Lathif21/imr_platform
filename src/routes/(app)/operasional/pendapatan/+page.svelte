<script lang="ts">
  import FileText from 'lucide-svelte/icons/file-text';
  import ListOrdered from 'lucide-svelte/icons/list-ordered';
  import Plus from 'lucide-svelte/icons/plus';
  import Printer from 'lucide-svelte/icons/printer';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import FormModal from '$lib/components/FormModal.svelte';
  import { withFeedback } from '$lib/form-feedback';
  import PilihPeriode from '$lib/operasional/PilihPeriode.svelte';
  import { NAMA_BULAN, bacaRupiah, ton } from '$lib/operasional/kegiatan';
  import { STATUS_ENTRY, TARIF_PAJAK, posisi, ringkas, sudahDibayar, type Posisi } from '$lib/operasional/pendapatan';
  import { BTN_ICON, BTN_ICON_DANGER, BTN_PRIMARY, BTN_SOFT, FIELD, LABEL, TEXTAREA, rupiah } from '$lib/operasional/ui';
  import type { PageData } from './$types';
  import type { PendapatanRow } from './+page.server';

  let { data }: { data: PageData } = $props();

  const angka = (n: number) => (n ? new Intl.NumberFormat('id-ID').format(n) : '');
  const formatDigit = (v: string) => {
    const d = v.replace(/\D/g, '');
    return d === '' ? '' : new Intl.NumberFormat('id-ID').format(Number(d));
  };

  /** Editable copy of a row: text for every input. */
  function dariData() {
    return data.baris.map((r) => ({
      id: r.id,
      tertaut: r.operasional_rekap_id !== null,
      no_urut: r.no_urut === null ? '' : String(r.no_urut),
      no_invoice: r.no_invoice ?? '',
      kegiatan: r.kegiatan,
      no_faktur_pajak: r.no_faktur_pajak ?? '',
      no_sto_spo: r.no_sto_spo ?? '',
      lokasi: r.lokasi ?? '',
      tanggal_kegiatan: r.tanggal_kegiatan ?? '',
      party_kg: angka(r.party_kg),
      harga: angka(r.harga),
      tarif_pajak: String(r.tarif_pajak),
      status_entry: r.status_entry ?? '',
      tanggal_entry: r.tanggal_entry ?? '',
      payment_date: r.payment_date ?? '',
      keterangan: r.keterangan ?? ''
    }));
  }

  let baris = $state(untrack(dariData));
  let filter = $state<Posisi | 'SEMUA'>(untrack(() => (data.status as Posisi | null) ?? 'SEMUA'));
  let saving = $state(false);
  let tambahOpen = $state(false);
  let party = $state('');
  let harga = $state('34.500');

  const entityQuery = $derived(data.opEntity ? `entitas=${encodeURIComponent(data.opEntity.code)}` : '');
  const periodeQuery = $derived(`${entityQuery}&bulan=${data.periode.bulan}&tahun=${data.periode.tahun}`);
  const namaBulan = $derived(`${NAMA_BULAN[data.periode.bulan - 1]} ${data.periode.tahun}`);

  /** Same formula as hitung_tagihan(): what will be stored once saved. */
  function hitung(b: (typeof baris)[number]) {
    const p = bacaRupiah(b.party_kg) ?? 0;
    const h = bacaRupiah(b.harga) ?? 0;
    const total = Math.round((p / 1000) * h * 100) / 100;
    const pajak = Math.round(total * Number(b.tarif_pajak) * 100 / 100) / 100;
    return { party_kg: p, total, pajak, net_tagihan: total - pajak };
  }

  const angkaBaris = $derived(
    baris.map((b) => ({ ...hitung(b), status_entry: b.status_entry || null, payment_date: b.payment_date || null }))
  );
  const bulanIni = $derived(ringkas(angkaBaris));
  const tampil = $derived(baris.map((b, i) => ({ b, i })).filter(({ i }) => filter === 'SEMUA' || posisi(angkaBaris[i]) === filter));

  const POSISI: { key: Posisi; label: string }[] = [
    { key: 'PENDING', label: 'Pending' },
    { key: 'JETTY', label: 'Jetty / Admin Lapangan' },
    { key: 'ACCOUNTING', label: 'Accounting' },
    { key: 'KIRIM PAKET', label: 'Kirim Paket' },
    { key: 'PROSES PAYMENT', label: 'Proses Payment' },
    { key: 'LUNAS', label: 'Lunas' }
  ];

  const barisJson = $derived(JSON.stringify(baris.map(({ tertaut: _t, ...rest }) => rest)));

  const simpan = withFeedback({
    failTitle: 'Data pendapatan gagal disimpan',
    onSuccess: () => (baris = dariData()),
    onPending: (p) => (saving = p)
  });
  const aksi = (failTitle: string, confirm?: Parameters<typeof withFeedback>[0]['confirm']) =>
    withFeedback({ failTitle, confirm, onSuccess: () => (baris = dariData()), onPending: (p) => (saving = p) });
  const tambah = withFeedback({
    failTitle: 'Data pendapatan gagal ditambahkan',
    onSuccess: () => {
      tambahOpen = false;
      baris = dariData();
    },
    onPending: (p) => (saving = p)
  });

  function hapus(b: (typeof baris)[number]) {
    return aksi('Data pendapatan gagal dihapus', {
      title: 'Hapus baris pendapatan?',
      message: `Invoice ${b.no_invoice || '(tanpa nomor)'} — ${b.kegiatan} akan dihapus.`,
      consequence: b.tertaut
        ? 'Baris ini dibuat dari kegiatan kapal dan akan dibuat ulang saat kegiatannya disimpan atau "Generate dari Kegiatan" ditekan. Pencairan dengan nomor invoice yang sama tidak ikut terhapus.'
        : 'Pencairan dengan nomor invoice yang sama tidak ikut terhapus. Tidak bisa dikembalikan.',
      confirmLabel: 'Ya, hapus',
      tone: 'danger'
    });
  }

  const CELL = 'h-[28px] px-2 bg-background border border-border rounded-md text-[12px] text-foreground focus:outline-none focus:border-primary w-full';
  const TH = 'font-medium py-2 px-2 whitespace-nowrap';

  function warnaStatus(s: string) {
    const p = posisi({ status_entry: s || null, payment_date: null });
    if (p === 'LUNAS') return 'text-positive';
    if (p === 'PROSES PAYMENT') return 'text-primary';
    if (p === 'PENDING') return 'text-warning';
    return 'text-foreground';
  }
</script>

<svelte:head><title>Laporan Pendapatan · Operasional · IMR Platform</title></svelte:head>

<div class="p-4 sm:p-5 space-y-4">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="text-[15px] font-semibold text-foreground">Laporan Pendapatan</h1>
      <p class="text-[12px] text-muted-foreground mt-0.5">Rekap income penagihan · {namaBulan} · {data.baris.length} invoice</p>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <PilihPeriode bulan={data.periode.bulan} tahun={data.periode.tahun} />
      <a href="/cetak/operasional/pendapatan?{periodeQuery}" target="_blank" rel="noopener" class={BTN_SOFT}><Printer size={14} /> Cetak</a>
      {#if data.canWrite}
        <form method="POST" action="?/generate" use:enhance={aksi('Generate gagal')}>
          <input type="hidden" name="entity_id" value={data.opEntity?.id} />
          <input type="hidden" name="bulan" value={data.periode.bulan} />
          <input type="hidden" name="tahun" value={data.periode.tahun} />
          <button type="submit" disabled={saving} class={BTN_SOFT} title="Buat baris untuk kegiatan kapal bulan ini yang belum punya, dan perbarui yang sudah ada">
            <RefreshCw size={14} /> Generate dari Kegiatan
          </button>
        </form>
        <form
          method="POST"
          action="?/rapikan"
          use:enhance={aksi('Nomor urut gagal dirapikan', {
            title: 'Rapikan nomor urut?',
            message: `Nomor urut ${namaBulan} menjadi 1, 2, 3, … menurut urutan sekarang.`,
            consequence:
              'Nomor invoice berpola otomatis (n/PT.IMR-…) ikut berganti, termasuk di pencairan. Invoice yang diketik manual atau sudah dibayar tidak berubah. Simpan perubahan di tabel lebih dulu.',
            confirmLabel: 'Ya, rapikan'
          })}
        >
          <input type="hidden" name="entity_id" value={data.opEntity?.id} />
          <input type="hidden" name="bulan" value={data.periode.bulan} />
          <input type="hidden" name="tahun" value={data.periode.tahun} />
          <button type="submit" disabled={saving} class={BTN_SOFT}><ListOrdered size={14} /> Rapikan Nomor</button>
        </form>
        <button type="button" onclick={() => ((party = ''), (harga = '34.500'), (tambahOpen = true))} class={BTN_PRIMARY}>
          <Plus size={14} /> Tambah Baris
        </button>
      {/if}
    </div>
  </div>

  <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
    {#each [
      { label: `Total ${namaBulan}`, j: bulanIni.semua, tone: 'text-foreground' },
      { label: 'Belum terbayar bulan ini', j: bulanIni.belum, tone: 'text-warning' },
      { label: 'Sudah dibayar bulan ini', j: bulanIni.sudah, tone: 'text-positive' },
      { label: 'Total keseluruhan piutang', j: data.keseluruhan.semua, tone: 'text-foreground' }
    ] as card (card.label)}
      <div class="bg-card border border-border rounded-lg px-4 py-3">
        <div class="text-[11px] text-muted-foreground">{card.label}</div>
        <div class="text-[16px] font-semibold num mt-1 {card.tone}">{rupiah(card.j.net_tagihan)}</div>
        <div class="text-[11px] text-muted-foreground num mt-0.5">
          {card.j.jumlah} invoice · {ton(card.j.party_kg)} KG · bruto {rupiah(card.j.total)}
        </div>
      </div>
    {/each}
  </div>

  <div class="flex items-center gap-1.5 flex-wrap text-[12px]">
    <span class="text-muted-foreground mr-1">Posisi piutang:</span>
    <button type="button" onclick={() => (filter = 'SEMUA')} class="px-2.5 py-1 rounded-md border {filter === 'SEMUA' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}">
      Semua · {baris.length}
    </button>
    {#each POSISI as p (p.key)}
      {@const j = bulanIni.perPosisi.get(p.key)}
      <button
        type="button"
        onclick={() => (filter = p.key)}
        class="px-2.5 py-1 rounded-md border {filter === p.key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}"
      >
        {p.label} · {j?.jumlah ?? 0}{#if j && j.net_tagihan}<span class="num"> · {rupiah(j.net_tagihan)}</span>{/if}
      </button>
    {/each}
  </div>

  <div class="bg-card border border-border rounded-lg overflow-hidden">
    <div class="overflow-x-auto">
      <fieldset disabled={!data.canWrite}>
        <table class="w-full min-w-[2100px] text-[12px]">
          <thead>
            <tr class="text-muted-foreground border-b border-border">
              <th class="{TH} text-center w-[56px]">No</th>
              <th class="{TH} text-left w-[170px]">No. Invoice</th>
              <th class="{TH} text-left w-[200px]">Kegiatan (Kapal)</th>
              <th class="{TH} text-left w-[150px]">No. Faktur Pajak</th>
              <th class="{TH} text-left w-[120px]">No. STO/SPO</th>
              <th class="{TH} text-left w-[200px]">Lokasi (Rute)</th>
              <th class="{TH} text-left w-[190px]">Tgl Kegiatan</th>
              <th class="{TH} text-right w-[110px]">Party (KG)</th>
              <th class="{TH} text-right w-[100px]">Harga /Ton</th>
              <th class="{TH} text-right w-[120px]">Total</th>
              <th class="{TH} text-left w-[150px]">Pajak</th>
              <th class="{TH} text-right w-[120px]">Net Tagihan</th>
              <th class="{TH} text-left w-[150px]">Status Entry</th>
              <th class="{TH} text-left w-[130px]">Tgl Entry</th>
              <th class="{TH} text-left w-[130px]">Payment Date</th>
              <th class="{TH} text-left w-[200px]">Keterangan</th>
              <th class="{TH} w-[64px]"></th>
            </tr>
          </thead>
          <tbody>
            {#each tampil as { b, i } (b.id)}
              {@const h = angkaBaris[i]}
              <tr class="border-b border-border/40 align-middle {sudahDibayar(h) ? 'bg-positive/5' : ''}">
                <td class="py-1.5 px-2"><input bind:value={b.no_urut} inputmode="numeric" aria-label="Nomor urut" class="{CELL} text-center num" /></td>
                <td class="py-1.5 px-2"><input bind:value={b.no_invoice} aria-label="Nomor invoice" class="{CELL} num" /></td>
                <td class="py-1.5 px-2">
                  <input bind:value={b.kegiatan} aria-label="Kegiatan" class={CELL} title={b.tertaut ? 'Tertaut ke kegiatan kapal' : ''} />
                </td>
                <td class="py-1.5 px-2"><input bind:value={b.no_faktur_pajak} aria-label="No faktur pajak" class="{CELL} num" /></td>
                <td class="py-1.5 px-2"><input bind:value={b.no_sto_spo} aria-label="No STO/SPO" class="{CELL} num" /></td>
                <td class="py-1.5 px-2"><input bind:value={b.lokasi} aria-label="Lokasi" class={CELL} /></td>
                <td class="py-1.5 px-2"><input bind:value={b.tanggal_kegiatan} aria-label="Tanggal kegiatan" class={CELL} /></td>
                <td class="py-1.5 px-2">
                  <input value={b.party_kg} oninput={(e) => (b.party_kg = formatDigit(e.currentTarget.value))} inputmode="numeric" aria-label="Party KG" class="{CELL} text-right num" />
                </td>
                <td class="py-1.5 px-2">
                  <input value={b.harga} oninput={(e) => (b.harga = formatDigit(e.currentTarget.value))} inputmode="numeric" aria-label="Harga per ton" class="{CELL} text-right num" />
                </td>
                <td class="py-1.5 px-2 text-right num whitespace-nowrap">{rupiah(h.total)}</td>
                <td class="py-1.5 px-2">
                  <select bind:value={b.tarif_pajak} aria-label="Tarif pajak" class={CELL}>
                    {#each TARIF_PAJAK as t (t)}<option value={String(t)}>{ton(t)}% · {rupiah(Math.round(h.total * t) / 100)}</option>{/each}
                  </select>
                </td>
                <td class="py-1.5 px-2 text-right num whitespace-nowrap font-semibold text-foreground">{rupiah(h.net_tagihan)}</td>
                <td class="py-1.5 px-2">
                  <select bind:value={b.status_entry} aria-label="Status entry" class="{CELL} font-medium {warnaStatus(b.status_entry)}">
                    <option value="">— Pilih —</option>
                    {#each STATUS_ENTRY as s (s)}<option value={s}>{s}</option>{/each}
                    {#if b.status_entry && !(STATUS_ENTRY as readonly string[]).includes(b.status_entry)}<option value={b.status_entry}>{b.status_entry}</option>{/if}
                  </select>
                </td>
                <td class="py-1.5 px-2"><input type="date" bind:value={b.tanggal_entry} aria-label="Tanggal entry" class={CELL} /></td>
                <td class="py-1.5 px-2"><input type="date" bind:value={b.payment_date} aria-label="Payment date" class={CELL} /></td>
                <td class="py-1.5 px-2"><input bind:value={b.keterangan} aria-label="Keterangan" class={CELL} /></td>
                <td class="py-1.5 px-2">
                  <div class="flex justify-end gap-0.5">
                    <a href="/cetak/operasional/ba/{b.id}?{entityQuery}" target="_blank" rel="noopener" class={BTN_ICON} title="Cetak Berita Acara" aria-label="Cetak BA {b.no_invoice}">
                      <FileText size={14} />
                    </a>
                    {#if data.canWrite}
                      <form method="POST" action="?/hapus" use:enhance={hapus(b)}>
                        <input type="hidden" name="id" value={b.id} />
                        <button type="submit" class={BTN_ICON_DANGER} aria-label="Hapus {b.no_invoice}" title="Hapus"><Trash2 size={14} /></button>
                      </form>
                    {/if}
                  </div>
                </td>
              </tr>
            {:else}
              <tr>
                <td colspan="17" class="py-10 px-4 text-center text-[12px] text-muted-foreground">
                  {#if filter !== 'SEMUA'}Tidak ada invoice pada posisi ini.{:else}Belum ada data pendapatan untuk {namaBulan}.{data.canWrite ? ' Tekan "Generate dari Kegiatan" atau "Tambah Baris".' : ''}{/if}
                </td>
              </tr>
            {/each}
          </tbody>
          {#if baris.length > 0}
            <tfoot>
              <tr class="border-t border-border bg-muted/40 font-semibold text-foreground">
                <td class="py-2 px-2" colspan="7">TOTAL {namaBulan.toUpperCase()}</td>
                <td class="py-2 px-2 text-right num">{ton(bulanIni.semua.party_kg)}</td>
                <td></td>
                <td class="py-2 px-2 text-right num whitespace-nowrap">{rupiah(bulanIni.semua.total)}</td>
                <td class="py-2 px-2 num whitespace-nowrap">{rupiah(bulanIni.semua.pajak)}</td>
                <td class="py-2 px-2 text-right num whitespace-nowrap">{rupiah(bulanIni.semua.net_tagihan)}</td>
                <td colspan="5"></td>
              </tr>
            </tfoot>
          {/if}
        </table>
      </fieldset>
    </div>
  </div>

  {#if data.canWrite && baris.length > 0}
    <form method="POST" action="?/simpanSemua" use:enhance={simpan} class="flex justify-end">
      <input type="hidden" name="baris" value={barisJson} />
      <button type="submit" disabled={saving} class={BTN_PRIMARY}>{saving ? 'Menyimpan…' : 'Simpan Semua Perubahan'}</button>
    </form>
  {/if}
</div>

<FormModal bind:open={tambahOpen} title="Tambah Baris Pendapatan Manual" wide>
  <form method="POST" action="?/tambah" use:enhance={tambah} class="space-y-3">
    <input type="hidden" name="entity_id" value={data.opEntity?.id} />
    <input type="hidden" name="bulan" value={data.periode.bulan} />
    <input type="hidden" name="tahun" value={data.periode.tahun} />
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <label class="block sm:col-span-2"><span class={LABEL}>Kegiatan (kapal)</span><input name="kegiatan" class={FIELD} /></label>
      <label class="block"><span class={LABEL}>No. invoice <span class="text-subtle">(kosong = otomatis)</span></span><input name="no_invoice" class={FIELD} /></label>
      <label class="block"><span class={LABEL}>No. faktur pajak</span><input name="no_faktur_pajak" class={FIELD} /></label>
      <label class="block"><span class={LABEL}>No. STO/SPO</span><input name="no_sto_spo" class={FIELD} /></label>
      <label class="block"><span class={LABEL}>Lokasi (rute)</span><input name="lokasi" class={FIELD} /></label>
      <label class="block"><span class={LABEL}>Tanggal kegiatan <span class="text-subtle">(teks)</span></span><input name="tanggal_kegiatan" placeholder="cth. 05 s/d 07 Oktober 2026" class={FIELD} /></label>
      <label class="block"><span class={LABEL}>Party (KG)</span><input name="party_kg" value={party} oninput={(e) => (party = formatDigit(e.currentTarget.value))} inputmode="numeric" class="{FIELD} text-right num" /></label>
      <label class="block"><span class={LABEL}>Harga per ton (Rp)</span><input name="harga" value={harga} oninput={(e) => (harga = formatDigit(e.currentTarget.value))} inputmode="numeric" class="{FIELD} text-right num" /></label>
      <label class="block"><span class={LABEL}>Tarif pajak</span>
        <select name="tarif_pajak" class={FIELD}>{#each TARIF_PAJAK as t (t)}<option value={String(t)}>{ton(t)}%</option>{/each}</select>
      </label>
      <label class="block"><span class={LABEL}>Status entry</span>
        <select name="status_entry" class={FIELD}><option value="">— Pilih —</option>{#each STATUS_ENTRY as s (s)}<option value={s}>{s}</option>{/each}</select>
      </label>
      <label class="block"><span class={LABEL}>Tanggal entry</span><input type="date" name="tanggal_entry" class={FIELD} /></label>
      <label class="block"><span class={LABEL}>Payment date</span><input type="date" name="payment_date" class={FIELD} /></label>
    </div>
    <label class="block"><span class={LABEL}>Keterangan</span><textarea name="keterangan" class={TEXTAREA}></textarea></label>
    <p class="text-[11px] text-muted-foreground num">
      Total = party ÷ 1.000 × harga = {rupiah(Math.round(((bacaRupiah(party) ?? 0) / 1000) * (bacaRupiah(harga) ?? 0) * 100) / 100)}
    </p>
    <div class="flex justify-end gap-2 pt-1">
      <button type="button" onclick={() => (tambahOpen = false)} class={BTN_SOFT}>Batal</button>
      <button type="submit" disabled={saving} class={BTN_PRIMARY}>{saving ? 'Menyimpan…' : 'Simpan Baris'}</button>
    </div>
  </form>
</FormModal>
