import type { Actions, PageServerLoad } from './$types';
import {
  explainDbError,
  failLoad,
  idFrom,
  invalid,
  optionalText,
  refuse,
  requiredText
} from '$lib/server/operasional';

export interface KapalRow {
  id: number;
  nama_kapal: string;
  pemilik_kapal: string | null;
  /** Detail Kegiatan Kapal (operasional_rekap) yang ikut terhapus. */
  jumlah_kegiatan: number;
  /** Baris truk (transaksi_operasional) yang ikut terhapus. */
  jumlah_transaksi: number;
  /** Pencairan lama (menu sudah dihapus) yang ikut terhapus. */
  jumlah_pencairan: number;
}

/** Hitung kemunculan kapal_id di satu tabel, untuk entitas yang dipilih. */
function countBy(rows: { kapal_id: number }[] | null): Map<number, number> {
  const out = new Map<number, number>();
  for (const row of rows ?? []) out.set(row.kapal_id, (out.get(row.kapal_id) ?? 0) + 1);
  return out;
}

export const load: PageServerLoad = async ({ locals, parent }) => {
  const { opEntity } = await parent();
  if (!opEntity) return { kapal: [] as KapalRow[] };

  const [kapalResult, rekapResult, transaksiResult, pencairanResult] = await Promise.all([
    locals.supabase
      .from('kapal')
      .select('id, nama_kapal, pemilik_kapal')
      .eq('entity_id', opEntity.id)
      .order('nama_kapal')
      .returns<{ id: number; nama_kapal: string; pemilik_kapal: string | null }[]>(),
    locals.supabase.from('operasional_rekap').select('kapal_id').eq('entity_id', opEntity.id).returns<{ kapal_id: number }[]>(),
    locals.supabase.from('transaksi_operasional').select('kapal_id').eq('entity_id', opEntity.id).returns<{ kapal_id: number }[]>(),
    locals.supabase.from('pencairan').select('kapal_id').eq('entity_id', opEntity.id).returns<{ kapal_id: number }[]>()
  ]);

  if (kapalResult.error) failLoad('kapal', kapalResult.error);
  if (rekapResult.error) failLoad('operasional_rekap', rekapResult.error);
  if (transaksiResult.error) failLoad('transaksi_operasional', transaksiResult.error);
  if (pencairanResult.error) failLoad('pencairan', pencairanResult.error);

  const kegiatan = countBy(rekapResult.data);
  const transaksi = countBy(transaksiResult.data);
  const pencairan = countBy(pencairanResult.data);

  return {
    kapal: (kapalResult.data ?? []).map((row) => ({
      ...row,
      jumlah_kegiatan: kegiatan.get(row.id) ?? 0,
      jumlah_transaksi: transaksi.get(row.id) ?? 0,
      jumlah_pencairan: pencairan.get(row.id) ?? 0
    }))
  };
};

/**
 * Nama kapal unik per entitas, seperti validasi `unique:kapal,nama_kapal`
 * di Laravel. Kolomnya sendiri sengaja tidak unik di skema (komentar tabel
 * kapal), jadi aturan ini dijaga di sini — dibandingkan tanpa memedulikan
 * besar-kecil huruf dan spasi berlebih, supaya "KM  Sinar" dan "km sinar"
 * tidak menjadi dua kapal yang membelah satu riwayat kegiatan.
 */
function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

const sameName = (a: string, b: string) => normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();

export const actions: Actions = {
  simpan: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    const entityId = requiredText(form, 'entity_id');
    const namaKapal = normalizeName(requiredText(form, 'nama_kapal'));
    const pemilikKapal = optionalText(form, 'pemilik_kapal');

    const details: string[] = [];
    if (namaKapal === '') details.push('Nama kapal wajib diisi.');
    if (namaKapal.length > 255) details.push('Nama kapal maksimal 255 karakter.');
    if (pemilikKapal && pemilikKapal.length > 255) details.push('Perusahaan pemilik kapal maksimal 255 karakter.');
    if (details.length) return invalid(details);

    const { data: existing, error: existingError } = await locals.supabase
      .from('kapal')
      .select('id, nama_kapal')
      .eq('entity_id', entityId)
      .returns<{ id: number; nama_kapal: string }[]>();
    if (existingError) {
      return refuse(explainDbError('kapal names', existingError, { fallback: 'Data kapal gagal disimpan.' }));
    }
    if ((existing ?? []).some((k) => k.id !== id && sameName(k.nama_kapal, namaKapal))) {
      return invalid(['Nama kapal ini sudah terdaftar.']);
    }

    const values = { nama_kapal: namaKapal, pemilik_kapal: pemilikKapal };

    if (id === null) {
      const { error } = await locals.supabase.from('kapal').insert({ ...values, entity_id: entityId });
      if (error) return refuse(explainDbError('insert kapal', error, { fallback: 'Kapal gagal ditambahkan.' }));
      return { title: 'Berhasil disimpan', message: `Kapal ${namaKapal} berhasil ditambahkan ke Master Data.` };
    }

    const { data, error } = await locals.supabase.from('kapal').update(values).eq('id', id).select('id');
    if (error) return refuse(explainDbError('update kapal', error, { fallback: 'Data kapal gagal diperbarui.' }));
    if (!data?.length) return refuse('Data kapal tidak ditemukan, atau Anda tidak berwenang mengubahnya.');
    return { title: 'Berhasil diperbarui', message: `Data kapal ${namaKapal} berhasil diperbarui.` };
  },

  /**
   * Sama seperti Laravel: kapal dihapus beserta seluruh detail kegiatan dan
   * rincian truknya. Lewat hapus_kapal() (migrasi 20250112) supaya honor
   * telly per kegiatan ikut terhapus dalam transaksi yang sama — FK-nya
   * SET NULL dan baris tanpa induk akan terbaca sebagai gaji admin. Pencairan
   * lamanya ikut terhapus (20250125: menu Pencairan dihapus).
   */
  hapus: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    if (id === null) return refuse('Kapal yang akan dihapus tidak dikenali.');

    const { data: kapal } = await locals.supabase
      .from('kapal')
      .select('nama_kapal')
      .eq('id', id)
      .maybeSingle<{ nama_kapal: string }>();

    const { error } = await locals.supabase.rpc('hapus_kapal', { p_kapal_id: id });
    if (error) return refuse(explainDbError('hapus_kapal', error, { fallback: 'Kapal gagal dihapus.' }));

    return {
      title: 'Berhasil dihapus',
      message: `Kapal ${kapal?.nama_kapal ?? ''} beserta seluruh detail kegiatan kapal dan rincian pembayaran truk terkait berhasil dihapus.`
    };
  }
};
