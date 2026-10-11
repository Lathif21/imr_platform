import type { Actions, PageServerLoad } from './$types';
import { bacaAngka, bacaRupiah, periodeDari } from '$lib/operasional/kegiatan';
import { ringkas } from '$lib/operasional/pendapatan';
import { ISO_DATE, explainDbError, failLoad, idFrom, invalid, refuse, requiredText } from '$lib/server/operasional';

/**
 * Laporan Pendapatan — LaporanController::pendapatan and its actions.
 *
 * This page only reads. Laravel's GET also created rows from kegiatan,
 * deleted rows it judged duplicate, and renumbered invoices. Rows now follow
 * their kegiatan when the kegiatan is saved (trigger, migration 20250115);
 * "Generate dari Kegiatan" and "Rapikan Nomor" are explicit buttons.
 */
export interface PendapatanRow {
  id: number;
  operasional_rekap_id: number | null;
  no_urut: number | null;
  no_invoice: string | null;
  kegiatan: string;
  no_faktur_pajak: string | null;
  no_sto_spo: string | null;
  lokasi: string | null;
  tanggal_kegiatan: string | null;
  party_kg: number;
  harga: number;
  total: number;
  tarif_pajak: number;
  pajak: number;
  net_tagihan: number;
  status_entry: string | null;
  tanggal_entry: string | null;
  payment_date: string | null;
  keterangan: string | null;
}

const NUMERIC = ['party_kg', 'harga', 'total', 'tarif_pajak', 'pajak', 'net_tagihan'] as const;

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  const kosong = {
    periode,
    baris: [] as PendapatanRow[],
    keseluruhan: ringkas([]),
    status: url.searchParams.get('status')
  };
  if (!opEntity) return kosong;

  const db = locals.supabase;
  const [rowsResult, allResult] = await Promise.all([
    db
      .from('laporan_pendapatan')
      .select(
        'id, operasional_rekap_id, no_urut, no_invoice, kegiatan, no_faktur_pajak, no_sto_spo, lokasi, tanggal_kegiatan, ' +
          'party_kg, harga, total, tarif_pajak, pajak, net_tagihan, status_entry, tanggal_entry, payment_date, keterangan'
      )
      .eq('entity_id', opEntity.id)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .order('no_urut', { ascending: true, nullsFirst: false })
      .order('id')
      .returns<Record<string, unknown>[]>(),
    // "Total keseluruhan piutang": every period of this entity, as Laravel.
    db
      .from('laporan_pendapatan')
      .select('party_kg, total, pajak, net_tagihan, status_entry, payment_date')
      .eq('entity_id', opEntity.id)
      .returns<Record<string, unknown>[]>()
  ]);
  if (rowsResult.error) failLoad('laporan_pendapatan', rowsResult.error);
  if (allResult.error) failLoad('laporan_pendapatan all', allResult.error);

  const asNumbers = <T extends Record<string, unknown>>(r: T) => {
    const out: Record<string, unknown> = { ...r };
    for (const k of NUMERIC) if (k in out) out[k] = Number(out[k] ?? 0);
    return out;
  };

  return {
    ...kosong,
    baris: (rowsResult.data ?? []).map((r) => asNumbers(r) as unknown as PendapatanRow),
    keseluruhan: ringkas((allResult.data ?? []).map((r) => asNumbers(r) as never))
  };
};

/** One typed row from the form, checked; `null` fields keep the stored value. */
function bacaBaris(raw: Record<string, unknown>, label: string, details: string[]) {
  const text = (k: string) => (raw[k] === undefined || raw[k] === null ? undefined : String(raw[k]));
  const party = bacaRupiah(text('party_kg') ?? '');
  const harga = bacaRupiah(text('harga') ?? '');
  const tarif = bacaAngka(text('tarif_pajak') ?? '');
  if (party === null) details.push(`${label}: party harus angka KG, mis. 10.500.`);
  if (harga === null) details.push(`${label}: harga harus angka rupiah.`);
  if (tarif === null || (tarif !== null && tarif > 100)) details.push(`${label}: tarif pajak tidak sah.`);
  for (const k of ['tanggal_entry', 'payment_date']) {
    const v = text(k);
    if (v && !ISO_DATE.test(v)) details.push(`${label}: tanggal tidak sah.`);
  }
  if (text('kegiatan') !== undefined && text('kegiatan')!.trim() === '') details.push(`${label}: kegiatan wajib diisi.`);
  const noUrut = text('no_urut');
  if (noUrut && !/^\d+$/.test(noUrut.trim())) details.push(`${label}: nomor urut harus bilangan bulat.`);

  return {
    ...raw,
    party_kg: String(party ?? 0),
    harga: String(harga ?? 0),
    tarif_pajak: String(tarif ?? 0)
  };
}

export const actions: Actions = {
  generate: async ({ locals, request }) => {
    const form = await request.formData();
    const { data, error } = await locals.supabase.rpc('generate_pendapatan', {
      p_entity_id: requiredText(form, 'entity_id'),
      p_bulan: Number(form.get('bulan')),
      p_tahun: Number(form.get('tahun'))
    });
    if (error) return refuse(explainDbError('generate_pendapatan', error, { fallback: 'Data pendapatan gagal digenerate.' }));
    return {
      title: 'Berhasil',
      message:
        data > 0
          ? `${data} baris pendapatan baru dibuat dari kegiatan kapal; baris yang sudah ada diperbarui mengikuti tonasenya.`
          : 'Semua kegiatan kapal bulan ini sudah punya baris pendapatan; baris yang ada diperbarui mengikuti tonasenya.'
    };
  },

  rapikan: async ({ locals, request }) => {
    const form = await request.formData();
    const { data, error } = await locals.supabase.rpc('rapikan_nomor_pendapatan', {
      p_entity_id: requiredText(form, 'entity_id'),
      p_bulan: Number(form.get('bulan')),
      p_tahun: Number(form.get('tahun'))
    });
    if (error) return refuse(explainDbError('rapikan_nomor_pendapatan', error, { fallback: 'Nomor urut gagal dirapikan.' }));
    return { title: 'Berhasil', message: data > 0 ? `${data} baris dinomori ulang.` : 'Nomor urut sudah rapi.' };
  },

  tambah: async ({ locals, request }) => {
    const form = await request.formData();
    const details: string[] = [];
    const raw = Object.fromEntries(
      ['no_urut', 'no_invoice', 'kegiatan', 'no_faktur_pajak', 'no_sto_spo', 'lokasi', 'tanggal_kegiatan', 'party_kg', 'harga', 'tarif_pajak', 'status_entry', 'tanggal_entry', 'payment_date', 'keterangan'].map(
        (k) => [k, String(form.get(k) ?? '')]
      )
    );
    if (raw.kegiatan.trim() === '') details.push('Kegiatan (kapal) wajib diisi.');
    if (raw.party_kg.trim() === '') details.push('Party (KG) wajib diisi.');
    if (raw.harga.trim() === '') details.push('Harga wajib diisi.');
    const data = bacaBaris(raw, 'Isian', details);
    if (details.length) return invalid(details);

    const { error } = await locals.supabase.rpc('tambah_pendapatan', {
      p_entity_id: requiredText(form, 'entity_id'),
      p_bulan: Number(form.get('bulan')),
      p_tahun: Number(form.get('tahun')),
      p_data: data
    });
    if (error) return refuse(explainDbError('tambah_pendapatan', error, { fallback: 'Data pendapatan gagal ditambahkan.' }));
    return { title: 'Berhasil disimpan', message: 'Data pendapatan berhasil ditambahkan.' };
  },

  simpanSemua: async ({ locals, request }) => {
    const form = await request.formData();
    let rows: Record<string, unknown>[] = [];
    try {
      const parsed = JSON.parse(String(form.get('baris') ?? '[]'));
      if (Array.isArray(parsed)) rows = parsed;
    } catch {
      return refuse('Data pendapatan tidak terbaca. Muat ulang halaman lalu coba lagi.');
    }
    if (rows.length === 0) return refuse('Tidak ada data pendapatan yang disimpan.');

    const details: string[] = [];
    const data = rows.map((r, i) => bacaBaris(r, `Baris ${r.no_urut ?? i + 1}`, details));
    if (details.length) return invalid(details);

    const { error } = await locals.supabase.rpc('simpan_pendapatan_massal', { p_rows: data });
    if (error) return refuse(explainDbError('simpan_pendapatan_massal', error, { fallback: 'Data pendapatan gagal disimpan.' }));
    return { title: 'Berhasil disimpan', message: 'Seluruh data pendapatan berhasil disimpan.' };
  },

  hapus: async ({ locals, request }) => {
    const id = idFrom(await request.formData());
    if (id === null) return refuse('Baris yang akan dihapus tidak dikenali.');
    const { data, error } = await locals.supabase.from('laporan_pendapatan').delete().eq('id', id).select('id');
    if (error) return refuse(explainDbError('hapus pendapatan', error, { fallback: 'Data pendapatan gagal dihapus.' }));
    if (!data?.length) return refuse('Data pendapatan tidak ditemukan, atau Anda tidak berwenang menghapusnya.');
    return { title: 'Berhasil dihapus', message: 'Data pendapatan berhasil dihapus.' };
  }
};
