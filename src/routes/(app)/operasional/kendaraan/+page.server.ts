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

export interface KendaraanRow {
  id: number;
  nopol: string;
  pemilik_id: number;
  nama_pemilik: string;
  npwp: string | null;
  jumlah_transaksi: number;
  jumlah_muatan: number;
}

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const filterPemilik = Number(url.searchParams.get('pemilik')) || null;
  if (!opEntity) {
    return { kendaraan: [] as KendaraanRow[], daftarPemilik: [], filterPemilik };
  }

  let kendaraanQuery = locals.supabase
    .from('v_kendaraan_ringkasan')
    .select('id, nopol, pemilik_id, nama_pemilik, npwp, jumlah_transaksi, jumlah_muatan')
    .eq('entity_id', opEntity.id)
    .order('nopol');
  if (filterPemilik) kendaraanQuery = kendaraanQuery.eq('pemilik_id', filterPemilik);

  const [kendaraanResult, pemilikResult] = await Promise.all([
    kendaraanQuery.returns<KendaraanRow[]>(),
    locals.supabase
      .from('pemilik')
      .select('id, nama_pemilik')
      .eq('entity_id', opEntity.id)
      .order('nama_pemilik')
      .returns<{ id: number; nama_pemilik: string }[]>()
  ]);

  if (kendaraanResult.error) failLoad('v_kendaraan_ringkasan', kendaraanResult.error);
  if (pemilikResult.error) failLoad('pemilik', pemilikResult.error);

  return {
    kendaraan: kendaraanResult.data ?? [],
    daftarPemilik: pemilikResult.data ?? [],
    filterPemilik
  };
};

/**
 * Nomor polisi is stored upper-cased with single spaces, so "bp  1234 xy" and
 * "BP 1234 XY" are the same plate to the unique index. Laravel upper-cased on
 * create only; an edit could save a lower-case duplicate past it.
 */
function normalizeNopol(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

const DUPLICATE_NOPOL = 'Nomor polisi itu sudah terdaftar di entitas ini.';

export const actions: Actions = {
  simpan: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    const entityId = requiredText(form, 'entity_id');
    const nopol = normalizeNopol(requiredText(form, 'nopol'));
    const pemilikId = idFrom(form, 'pemilik_id');
    const npwp = optionalText(form, 'npwp');

    const details: string[] = [];
    if (nopol === '') details.push('Nomor polisi wajib diisi.');
    if (nopol.length > 255) details.push('Nomor polisi maksimal 255 karakter.');
    if (pemilikId === null) details.push('Pemilik kendaraan wajib dipilih.');
    if (npwp && npwp.length > 255) details.push('NPWP maksimal 255 karakter.');
    if (details.length) return invalid(details);

    const values = { nopol, pemilik_id: pemilikId, npwp };

    if (id === null) {
      const { error } = await locals.supabase
        .from('kendaraan')
        .insert({ ...values, entity_id: entityId });
      if (error) {
        return refuse(
          explainDbError('insert kendaraan', error, {
            duplicate: DUPLICATE_NOPOL,
            fallback: 'Kendaraan gagal ditambahkan.'
          })
        );
      }
      return { title: 'Berhasil disimpan', message: `Kendaraan ${nopol} berhasil ditambahkan.` };
    }

    const { data, error } = await locals.supabase
      .from('kendaraan')
      .update(values)
      .eq('id', id)
      .select('id');
    if (error) {
      return refuse(
        explainDbError('update kendaraan', error, {
          duplicate: DUPLICATE_NOPOL,
          fallback: 'Data kendaraan gagal diperbarui.'
        })
      );
    }
    if (!data?.length) return refuse('Data kendaraan tidak ditemukan, atau Anda tidak berwenang mengubahnya.');
    return { title: 'Berhasil diperbarui', message: `Data kendaraan ${nopol} berhasil diperbarui.` };
  },

  /**
   * Laravel refused only when the vehicle had transactions. This also refuses
   * when it has muatan rows on a kapal: kapal_muatan_detail.kendaraan_id is
   * ON DELETE CASCADE, so deleting the vehicle would delete those rows too,
   * with no word to the user.
   */
  hapus: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    if (id === null) return refuse('Kendaraan yang akan dihapus tidak dikenali.');

    const { data: usage, error: usageError } = await locals.supabase
      .from('v_kendaraan_ringkasan')
      .select('nopol, jumlah_transaksi, jumlah_muatan')
      .eq('id', id)
      .maybeSingle<{ nopol: string; jumlah_transaksi: number; jumlah_muatan: number }>();
    if (usageError) {
      return refuse(explainDbError('kendaraan usage', usageError, { fallback: 'Kendaraan gagal dihapus.' }));
    }
    if (!usage) return refuse('Data kendaraan tidak ditemukan.');

    const blockers: string[] = [];
    if (usage.jumlah_transaksi > 0) blockers.push(`Dipakai di ${usage.jumlah_transaksi} transaksi operasional.`);
    if (usage.jumlah_muatan > 0) blockers.push(`Tercatat di ${usage.jumlah_muatan} rincian muatan kapal.`);
    if (blockers.length) {
      return refuse(`Kendaraan ${usage.nopol} tidak bisa dihapus karena sudah dipakai.`, blockers);
    }

    const { data, error } = await locals.supabase.from('kendaraan').delete().eq('id', id).select('id');
    if (error) return refuse(explainDbError('delete kendaraan', error, { fallback: 'Kendaraan gagal dihapus.' }));
    if (!data?.length) return refuse('Data kendaraan tidak ditemukan, atau Anda tidak berwenang menghapusnya.');
    return { title: 'Berhasil dihapus', message: `Kendaraan ${usage.nopol} berhasil dihapus.` };
  }
};
