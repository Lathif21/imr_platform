import type { Actions, PageServerLoad } from './$types';
import {
  explainDbError,
  failLoad,
  idFrom,
  invalid,
  refuse,
  requiredText
} from '$lib/server/operasional';

export interface PemilikRow {
  id: number;
  nama_pemilik: string;
  jumlah_kendaraan: number;
  total_pendapatan_rekanan: string | number;
}

export const load: PageServerLoad = async ({ locals, parent }) => {
  const { opEntity } = await parent();
  if (!opEntity) return { pemilik: [] as PemilikRow[] };

  const { data, error } = await locals.supabase
    .from('v_pemilik_ringkasan')
    .select('id, nama_pemilik, jumlah_kendaraan, total_pendapatan_rekanan')
    .eq('entity_id', opEntity.id)
    .order('nama_pemilik')
    .returns<PemilikRow[]>();

  if (error) failLoad('v_pemilik_ringkasan', error);
  return { pemilik: data ?? [] };
};

export const actions: Actions = {
  /** Create when there is no id, update when there is. One form, one action. */
  simpan: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    const entityId = requiredText(form, 'entity_id');
    const nama = requiredText(form, 'nama_pemilik');

    const details: string[] = [];
    if (nama === '') details.push('Nama pemilik wajib diisi.');
    if (nama.length > 255) details.push('Nama pemilik maksimal 255 karakter.');
    if (details.length) return invalid(details);

    if (id === null) {
      const { error } = await locals.supabase
        .from('pemilik')
        .insert({ entity_id: entityId, nama_pemilik: nama });
      if (error) {
        return refuse(explainDbError('insert pemilik', error, { fallback: 'Pemilik gagal ditambahkan.' }));
      }
      return { title: 'Berhasil disimpan', message: `Pemilik ${nama} berhasil ditambahkan.` };
    }

    // `.select()` because an update RLS filters out is not an error — it is
    // zero rows, and without counting them the screen would report success.
    const { data, error } = await locals.supabase
      .from('pemilik')
      .update({ nama_pemilik: nama })
      .eq('id', id)
      .select('id');
    if (error) {
      return refuse(explainDbError('update pemilik', error, { fallback: 'Data pemilik gagal diperbarui.' }));
    }
    if (!data?.length) return refuse('Data pemilik tidak ditemukan, atau Anda tidak berwenang mengubahnya.');
    return { title: 'Berhasil diperbarui', message: 'Data pemilik berhasil diperbarui.' };
  },

  /**
   * Refused while the owner still has vehicles — Laravel's rule. The foreign
   * key is ON DELETE CASCADE, so without this check deleting an owner would
   * take every vehicle, and every muatan row on them, with it.
   */
  hapus: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    if (id === null) return refuse('Pemilik yang akan dihapus tidak dikenali.');

    const { count, error: countError } = await locals.supabase
      .from('kendaraan')
      .select('id', { count: 'exact', head: true })
      .eq('pemilik_id', id);
    if (countError) {
      return refuse(explainDbError('count kendaraan', countError, { fallback: 'Pemilik gagal dihapus.' }));
    }
    if ((count ?? 0) > 0) {
      return refuse(
        `Pemilik tidak bisa dihapus karena masih memiliki ${count} kendaraan. Pindahkan atau hapus kendaraannya lebih dulu.`
      );
    }

    const { data, error } = await locals.supabase.from('pemilik').delete().eq('id', id).select('id');
    if (error) return refuse(explainDbError('delete pemilik', error, { fallback: 'Pemilik gagal dihapus.' }));
    if (!data?.length) return refuse('Data pemilik tidak ditemukan, atau Anda tidak berwenang menghapusnya.');
    return { title: 'Berhasil dihapus', message: 'Pemilik berhasil dihapus.' };
  }
};
