import { error } from '@sveltejs/kit';
import { periodeDari } from '$lib/operasional/kegiatan';
import { canReadOperational } from '$lib/roles';
import { LAPORAN_EXCEL, URUTAN_LAPORAN, bukuLaporan } from '$lib/server/laporan-excel';
import { loadOperationalEntities } from '$lib/server/operasional';
import type { RequestHandler } from './$types';

/**
 * Excel of the monthly operational reports.
 *
 *   ?laporan=<kunci>  one report (kegiatan, kumpulan, pendapatan, …)
 *   ?laporan=semua    every report of the month, a sheet each
 *
 * with the usual ?entitas=&bulan=&tahun=. This route runs no layout load, so
 * it checks the role and resolves the entity itself; every read goes through
 * the caller's client, so RLS still decides what is in the file.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  if (!canReadOperational(locals.role)) error(403, 'Peran Anda tidak membaca data operasional.');

  const laporan = url.searchParams.get('laporan') ?? '';
  const kunci = laporan === 'semua' ? URUTAN_LAPORAN : LAPORAN_EXCEL[laporan] ? [laporan] : null;
  if (!kunci) error(404, 'Laporan tidak dikenal.');

  const { selected } = await loadOperationalEntities(locals.supabase, url.searchParams.get('entitas'));
  if (!selected) error(403, 'Akun Anda belum ditautkan ke entitas mana pun.');

  const periode = periodeDari(url);
  const isi = await bukuLaporan(
    { db: locals.supabase, entityId: selected.id, periode },
    selected.legal_name,
    kunci
  );

  const nama = laporan === 'semua' ? 'Semua Laporan' : LAPORAN_EXCEL[laporan].label;
  const bulan = `${periode.tahun}-${String(periode.bulan).padStart(2, '0')}`;
  const berkas = `${nama} ${selected.code} ${bulan}.xlsx`;

  return new Response(new Uint8Array(isi), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${berkas.replace(/[^\w .-]/g, '')}"; filename*=UTF-8''${encodeURIComponent(berkas)}`,
      'cache-control': 'no-store'
    }
  });
};
