import type { Actions, PageServerLoad } from './$types';
import { bacaRupiah, periodeDari, rentangBulan } from '$lib/operasional/kegiatan';
import {
  ISO_DATE,
  explainDbError,
  failLoad,
  idFrom,
  invalid,
  optionalText,
  refuse,
  requiredText
} from '$lib/server/operasional';

/**
 * Pengeluaran — PengeluaranController (index/store/update/destroy) and the
 * input part of laporan/pengeluaran. Plain rows, one table: no function
 * needed. The printed report is Fase 4.
 *
 * `jenis` is matched EXACTLY by operational_expense_mapping when the finance
 * portal pulls the month, so the form offers the existing spellings first
 * and a new one only on purpose — a typo becomes "Pengeluaran lain-lain".
 */
export interface PengeluaranRow {
  id: number;
  tanggal: string;
  jenis: string;
  nama_kegiatan: string | null;
  jumlah: number;
  penerima: string | null;
  keterangan: string | null;
}

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  const kosong = { periode, pengeluaran: [] as PengeluaranRow[], daftarJenis: [] as string[], daftarPenerima: [] as { nama: string; jabatan: string | null }[] };
  if (!opEntity) return kosong;

  const db = locals.supabase;
  const { dari, sampai } = rentangBulan(periode);

  const [rowsResult, jenisResult, mappingResult, karyawanResult] = await Promise.all([
    db
      .from('pengeluaran')
      .select('id, tanggal, jenis, nama_kegiatan, jumlah, penerima, keterangan')
      .eq('entity_id', opEntity.id)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .order('tanggal', { ascending: false })
      .order('id', { ascending: false })
      .returns<(Omit<PengeluaranRow, 'jumlah'> & { jumlah: string })[]>(),
    db.from('pengeluaran').select('jenis').eq('entity_id', opEntity.id).returns<{ jenis: string }[]>(),
    db
      .from('operational_expense_mapping')
      .select('jenis')
      .eq('entity_id', opEntity.id)
      .eq('source', 'pengeluaran')
      .returns<{ jenis: string }[]>(),
    db
      .from('karyawan')
      .select('nama, jabatan, status')
      .eq('entity_id', opEntity.id)
      .order('nama')
      .returns<{ nama: string; jabatan: string | null; status: string }[]>()
  ]);

  if (rowsResult.error) failLoad('pengeluaran', rowsResult.error);
  if (jenisResult.error) failLoad('pengeluaran jenis', jenisResult.error);
  if (karyawanResult.error) failLoad('karyawan', karyawanResult.error);
  // mappingResult only enriches the list of spellings; an error there
  // (a role that may not read the mapping) is not worth failing the page.

  const jenis = new Set([...(jenisResult.data ?? []), ...(mappingResult.data ?? [])].map((r) => r.jenis));

  return {
    ...kosong,
    pengeluaran: (rowsResult.data ?? []).map((r) => ({ ...r, jumlah: Number(r.jumlah) })),
    daftarJenis: [...jenis].sort((a, b) => a.localeCompare(b, 'id')),
    daftarPenerima: (karyawanResult.data ?? [])
      .filter((k) => k.status === 'aktif')
      .map((k) => ({ nama: k.nama, jabatan: k.jabatan }))
  };
};

export const actions: Actions = {
  simpan: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    const tanggal = requiredText(form, 'tanggal');
    const jenis = requiredText(form, 'jenis').replace(/\s+/g, ' ');
    const namaKegiatan = optionalText(form, 'nama_kegiatan');
    const jumlah = bacaRupiah(String(form.get('jumlah') ?? ''));
    const penerima = optionalText(form, 'penerima');

    const details: string[] = [];
    if (!ISO_DATE.test(tanggal)) details.push('Tanggal wajib diisi.');
    if (jenis === '') details.push('Jenis pengeluaran wajib dipilih atau diisi.');
    if (jenis.length > 255) details.push('Jenis pengeluaran maksimal 255 karakter.');
    if (namaKegiatan && namaKegiatan.length > 255) details.push('Nama pengeluaran maksimal 255 karakter.');
    if (penerima && penerima.length > 255) details.push('Penerima maksimal 255 karakter.');
    if (jumlah === null) details.push('Jumlah harus berupa angka rupiah, mis. 1.250.000.');
    else if (String(form.get('jumlah') ?? '').trim() === '') details.push('Jumlah wajib diisi.');
    if (details.length) return invalid(details);

    const values = {
      tanggal,
      jenis,
      nama_kegiatan: namaKegiatan,
      jumlah,
      penerima,
      keterangan: optionalText(form, 'keterangan')
    };

    if (id === null) {
      const { error } = await locals.supabase.from('pengeluaran').insert({ ...values, entity_id: requiredText(form, 'entity_id') });
      if (error) return refuse(explainDbError('insert pengeluaran', error, { fallback: 'Pengeluaran gagal disimpan.' }));
      return { title: 'Berhasil disimpan', message: 'Pengeluaran berhasil disimpan.' };
    }

    const { data, error } = await locals.supabase.from('pengeluaran').update(values).eq('id', id).select('id');
    if (error) return refuse(explainDbError('update pengeluaran', error, { fallback: 'Pengeluaran gagal diperbarui.' }));
    if (!data?.length) return refuse('Data pengeluaran tidak ditemukan, atau Anda tidak berwenang mengubahnya.');
    return { title: 'Berhasil diperbarui', message: 'Pengeluaran berhasil diperbarui.' };
  },

  hapus: async ({ locals, request }) => {
    const id = idFrom(await request.formData());
    if (id === null) return refuse('Pengeluaran yang akan dihapus tidak dikenali.');

    const { data, error } = await locals.supabase.from('pengeluaran').delete().eq('id', id).select('id');
    if (error) return refuse(explainDbError('hapus pengeluaran', error, { fallback: 'Pengeluaran gagal dihapus.' }));
    if (!data?.length) return refuse('Data pengeluaran tidak ditemukan, atau Anda tidak berwenang menghapusnya.');
    return { title: 'Berhasil dihapus', message: 'Pengeluaran berhasil dihapus.' };
  }
};
