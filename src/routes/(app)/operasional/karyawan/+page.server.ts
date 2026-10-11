import type { Actions, PageServerLoad } from './$types';
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

export type StatusKinerja = 'Normal' | 'SP1' | 'SP2' | 'SP3';
export type JenisCatatan = 'catatan' | 'SP1' | 'SP2' | 'SP3';

export interface KaryawanRow {
  id: number;
  nama: string;
  no_hp: string | null;
  alamat: string | null;
  tanggal_bergabung: string | null;
  status: 'aktif' | 'nonaktif';
  jabatan: string | null;
  ktp: string | null;
  npwp: string | null;
  status_kinerja: StatusKinerja;
  jumlah_transaksi_telly: number;
  jumlah_gaji_telly: number;
}

export interface CatatanRow {
  id: number;
  karyawan_id: number;
  tanggal: string;
  jenis: JenisCatatan;
  keterangan: string | null;
}

const JENIS: JenisCatatan[] = ['catatan', 'SP1', 'SP2', 'SP3'];

export const load: PageServerLoad = async ({ locals, parent }) => {
  const { opEntity } = await parent();
  if (!opEntity) return { karyawan: [] as KaryawanRow[], catatan: [] as CatatanRow[] };

  const [karyawanResult, catatanResult] = await Promise.all([
    locals.supabase
      .from('v_karyawan_ringkasan')
      .select(
        'id, nama, no_hp, alamat, tanggal_bergabung, status, jabatan, ktp, npwp, status_kinerja, jumlah_transaksi_telly, jumlah_gaji_telly'
      )
      .eq('entity_id', opEntity.id)
      .order('status')
      .order('nama')
      .returns<KaryawanRow[]>(),
    // Newest first, as Laravel's catatan() relation: latest('tanggal').
    locals.supabase
      .from('karyawan_catatan')
      .select('id, karyawan_id, tanggal, jenis, keterangan')
      .eq('entity_id', opEntity.id)
      .order('tanggal', { ascending: false })
      .order('id', { ascending: false })
      .returns<CatatanRow[]>()
  ]);

  if (karyawanResult.error) failLoad('v_karyawan_ringkasan', karyawanResult.error);
  if (catatanResult.error) failLoad('karyawan_catatan', catatanResult.error);

  return { karyawan: karyawanResult.data ?? [], catatan: catatanResult.data ?? [] };
};

/**
 * Laravel's rules(), field for field. tarif_telly and pph_persen are not on
 * this form: revision 1.2 hid the salary rate from the employee screen, and
 * leaving them out of the update means an edit here can never overwrite them.
 */
function readKaryawan(form: FormData) {
  const values = {
    nama: requiredText(form, 'nama'),
    no_hp: optionalText(form, 'no_hp'),
    alamat: optionalText(form, 'alamat'),
    tanggal_bergabung: optionalText(form, 'tanggal_bergabung'),
    status: optionalText(form, 'status') ?? 'aktif',
    jabatan: optionalText(form, 'jabatan'),
    ktp: optionalText(form, 'ktp'),
    npwp: optionalText(form, 'npwp')
  };

  const details: string[] = [];
  if (values.nama === '') details.push('Nama karyawan wajib diisi.');
  if (values.nama.length > 255) details.push('Nama karyawan maksimal 255 karakter.');
  if (values.no_hp && values.no_hp.length > 30) details.push('No. HP maksimal 30 karakter.');
  if (values.tanggal_bergabung && !ISO_DATE.test(values.tanggal_bergabung)) {
    details.push('Tanggal bergabung tidak valid.');
  }
  if (values.status !== 'aktif' && values.status !== 'nonaktif') {
    details.push('Status harus aktif atau nonaktif.');
  }
  for (const [field, label] of [
    ['jabatan', 'Jabatan'],
    ['ktp', 'No. KTP'],
    ['npwp', 'No. NPWP']
  ] as const) {
    if ((values[field]?.length ?? 0) > 255) details.push(`${label} maksimal 255 karakter.`);
  }

  return { values, details };
}

export const actions: Actions = {
  simpan: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    const entityId = requiredText(form, 'entity_id');
    const { values, details } = readKaryawan(form);
    if (details.length) return invalid(details);

    if (id === null) {
      const { error } = await locals.supabase.from('karyawan').insert({ ...values, entity_id: entityId });
      if (error) {
        return refuse(explainDbError('insert karyawan', error, { fallback: 'Karyawan gagal ditambahkan.' }));
      }
      return { title: 'Berhasil disimpan', message: `Karyawan ${values.nama} berhasil ditambahkan.` };
    }

    const { data, error } = await locals.supabase
      .from('karyawan')
      .update(values)
      .eq('id', id)
      .select('id');
    if (error) {
      return refuse(explainDbError('update karyawan', error, { fallback: 'Data karyawan gagal diperbarui.' }));
    }
    if (!data?.length) return refuse('Data karyawan tidak ditemukan, atau Anda tidak berwenang mengubahnya.');
    return { title: 'Berhasil diperbarui', message: `Data ${values.nama} berhasil diperbarui.` };
  },

  /**
   * Laravel's rule: refused while the employee is the telly on a transaction
   * or has salary rows. gaji_telly.karyawan_id is ON DELETE CASCADE, so
   * deleting would erase salary history that reports and the P&L read.
   */
  hapus: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    if (id === null) return refuse('Karyawan yang akan dihapus tidak dikenali.');

    const { data: usage, error: usageError } = await locals.supabase
      .from('v_karyawan_ringkasan')
      .select('nama, jumlah_transaksi_telly, jumlah_gaji_telly')
      .eq('id', id)
      .maybeSingle<{ nama: string; jumlah_transaksi_telly: number; jumlah_gaji_telly: number }>();
    if (usageError) {
      return refuse(explainDbError('karyawan usage', usageError, { fallback: 'Karyawan gagal dihapus.' }));
    }
    if (!usage) return refuse('Data karyawan tidak ditemukan.');

    const blockers: string[] = [];
    if (usage.jumlah_transaksi_telly > 0) {
      blockers.push(`Menjadi telly di ${usage.jumlah_transaksi_telly} transaksi operasional.`);
    }
    if (usage.jumlah_gaji_telly > 0) blockers.push(`Punya ${usage.jumlah_gaji_telly} baris gaji telly.`);
    if (blockers.length) {
      return refuse(
        `${usage.nama} tidak bisa dihapus karena masih terkait transaksi atau gaji. Ubah statusnya menjadi nonaktif bila sudah tidak bekerja.`,
        blockers
      );
    }

    const { data, error } = await locals.supabase.from('karyawan').delete().eq('id', id).select('id');
    if (error) return refuse(explainDbError('delete karyawan', error, { fallback: 'Karyawan gagal dihapus.' }));
    if (!data?.length) return refuse('Data karyawan tidak ditemukan, atau Anda tidak berwenang menghapusnya.');
    return { title: 'Berhasil dihapus', message: `${usage.nama} berhasil dihapus.` };
  },

  tambahCatatan: async ({ locals, request }) => {
    const form = await request.formData();
    const karyawanId = idFrom(form, 'karyawan_id');
    const entityId = requiredText(form, 'entity_id');
    const tanggal = requiredText(form, 'tanggal');
    const jenis = requiredText(form, 'jenis') as JenisCatatan;
    const keterangan = optionalText(form, 'keterangan');

    const details: string[] = [];
    if (karyawanId === null) details.push('Karyawan tidak dikenali.');
    if (!ISO_DATE.test(tanggal)) details.push('Tanggal wajib diisi.');
    if (!JENIS.includes(jenis)) details.push('Jenis catatan harus Catatan, SP1, SP2, atau SP3.');
    if (details.length) return invalid(details);

    const { error } = await locals.supabase.from('karyawan_catatan').insert({
      entity_id: entityId,
      karyawan_id: karyawanId,
      tanggal,
      jenis,
      keterangan
    });
    if (error) {
      return refuse(
        explainDbError('insert karyawan_catatan', error, { fallback: 'Catatan kinerja gagal ditambahkan.' })
      );
    }
    return {
      title: 'Berhasil disimpan',
      message: jenis === 'catatan' ? 'Catatan kinerja berhasil ditambahkan.' : `${jenis} berhasil dicatat.`
    };
  },

  hapusCatatan: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    if (id === null) return refuse('Catatan yang akan dihapus tidak dikenali.');

    const { data, error } = await locals.supabase.from('karyawan_catatan').delete().eq('id', id).select('id');
    if (error) {
      return refuse(explainDbError('delete karyawan_catatan', error, { fallback: 'Catatan gagal dihapus.' }));
    }
    if (!data?.length) return refuse('Catatan tidak ditemukan, atau Anda tidak berwenang menghapusnya.');
    return { title: 'Berhasil dihapus', message: 'Catatan kinerja berhasil dihapus.' };
  }
};
