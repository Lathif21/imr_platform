import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { entitasCetak } from '$lib/server/cetak';
import { isAdmin, muatGaji } from '$lib/server/gaji';

/** Slip Gaji — the slip modal of laporan/telly, as a page of its own. */
export const load: PageServerLoad = async ({ locals, url }) => {
  const entity = await entitasCetak(locals, url);
  const periode = periodeDari(url);
  const id = Number(url.searchParams.get('karyawan')) || null;
  const g = await muatGaji(locals.supabase, entity.id, periode);
  const k = id === null ? undefined : g.karyawan.find((x) => x.id === id);
  return {
    entity,
    periode,
    ringkas: k ? g.ringkas.filter((r) => r.id === k.id) : g.ringkas,
    karyawan: k ? { nama: k.nama, jabatan: k.jabatan, ktp: k.ktp, npwp: k.npwp, admin: isAdmin(k.jabatan) } : null,
    honor: k ? (g.honor.get(k.id) ?? []) : [],
    admin: k ? (g.admin.get(k.id) ?? null) : null
  };
};
