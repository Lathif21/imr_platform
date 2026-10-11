import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { entitasCetak } from '$lib/server/cetak';
import { jumlahPartner, muatPartner } from '$lib/server/partner';

/** Rekapitulasi Biaya Kendaraan — the per-owner print of laporan/partner. */
export const load: PageServerLoad = async ({ locals, url }) => {
  const entity = await entitasCetak(locals, url);
  const periode = periodeDari(url);
  const p = await muatPartner(locals.supabase, entity.id, periode);
  const pemilik = p.ringkas.find((r) => r.id === Number(url.searchParams.get('pemilik')));
  if (!pemilik) error(404, 'Pemilik kendaraan tidak ditemukan.');
  const rincian = p.perPemilik.get(pemilik.id) ?? [];
  return { entity, periode, pemilik, rincian, jumlah: jumlahPartner(rincian) };
};
