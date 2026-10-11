import type { Actions, PageServerLoad } from './$types';
import { bacaRupiah, periodeDari } from '$lib/operasional/kegiatan';
import { isAdmin, muatGaji, type BarisAdmin, type BarisHonor } from '$lib/server/gaji';
import { explainDbError, idFrom, invalid, optionalText, refuse, requiredText } from '$lib/server/operasional';

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  const karyawanId = Number(url.searchParams.get('karyawan')) || null;
  const kosong = {
    periode,
    ringkas: [] as Awaited<ReturnType<typeof muatGaji>>['ringkas'],
    daftar: [] as { id: number; nama: string; jabatan: string | null }[],
    dipilih: null as { id: number; nama: string; jabatan: string | null; ktp: string | null; npwp: string | null; admin: boolean } | null,
    honor: [] as BarisHonor[],
    admin: null as BarisAdmin | null
  };
  if (!opEntity) return kosong;

  const g = await muatGaji(locals.supabase, opEntity.id, periode);
  const k = karyawanId === null ? undefined : g.karyawan.find((x) => x.id === karyawanId);
  return {
    ...kosong,
    ringkas: g.ringkas,
    daftar: g.karyawan.filter((x) => x.status === 'aktif' || x.id === karyawanId).map((x) => ({ id: x.id, nama: x.nama, jabatan: x.jabatan })),
    dipilih: k ? { id: k.id, nama: k.nama, jabatan: k.jabatan, ktp: k.ktp, npwp: k.npwp, admin: isAdmin(k.jabatan) } : null,
    honor: k ? (g.honor.get(k.id) ?? []) : [],
    admin: k && isAdmin(k.jabatan) ? (g.admin.get(k.id) ?? { id: null, gaji_total: 0, pph: 0, gaji_bersih: 0, keterangan: null }) : null
  };
};

export const actions: Actions = {
  simpanTelly: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    const gaji = bacaRupiah(String(form.get('gaji') ?? ''));
    const pph = bacaRupiah(String(form.get('pph') ?? ''));
    const details: string[] = [];
    if (id === null) details.push('Baris gaji tidak dikenali.');
    if (gaji === null) details.push('Gaji per ton harus angka rupiah.');
    if (pph === null) details.push('PPh harus angka rupiah.');
    if (details.length) return invalid(details);

    const { error } = await locals.supabase.rpc('simpan_gaji_telly', {
      p_id: id,
      p_gaji: gaji,
      p_pph: pph,
      p_keterangan: optionalText(form, 'keterangan')
    });
    if (error) return refuse(explainDbError('simpan_gaji_telly', error, { fallback: 'Rincian gaji telly gagal diperbarui.' }));
    return { title: 'Berhasil diperbarui', message: 'Rincian gaji telly berhasil diperbarui.' };
  },

  simpanAdmin: async ({ locals, request }) => {
    const form = await request.formData();
    const total = bacaRupiah(String(form.get('gaji_total') ?? ''));
    const pph = bacaRupiah(String(form.get('pph') ?? ''));
    const details: string[] = [];
    if (total === null) details.push('Gaji kotor harus angka rupiah.');
    if (pph === null) details.push('PPh harus angka rupiah.');
    if (details.length) return invalid(details);

    const { error } = await locals.supabase.rpc('simpan_gaji_admin', {
      p_entity_id: requiredText(form, 'entity_id'),
      p_karyawan_id: idFrom(form, 'karyawan_id'),
      p_bulan: Number(form.get('bulan')),
      p_tahun: Number(form.get('tahun')),
      p_gaji_total: total,
      p_pph: pph,
      p_keterangan: optionalText(form, 'keterangan')
    });
    if (error) return refuse(explainDbError('simpan_gaji_admin', error, { fallback: 'Gaji gagal disimpan.' }));
    return { title: 'Berhasil disimpan', message: 'Gaji berhasil diperbarui.' };
  }
};
