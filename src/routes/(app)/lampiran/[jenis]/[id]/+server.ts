import { error, json, redirect } from '@sveltejs/kit';
import { bisaDilihat, isJenisLampiran } from '$lib/lampiran';
import { KONFIG } from '$lib/server/lampiran';
import { StorageNotConfigured, deleteObject, presignDownload } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/**
 * One lampiran. GET opens it (PDF and photos in the tab, the rest
 * downloads; `?unduh` always downloads) through a two-minute presigned URL;
 * DELETE removes the record, then the object. Both read the record with the
 * caller's client: a lampiran RLS hides is a 404, not a file.
 */

async function baca(locals: App.Locals, jenis: string, id: string) {
  if (!isJenisLampiran(jenis) || !/^\d+$/.test(id)) error(404, 'Lampiran tidak ditemukan.');
  const { tabel } = KONFIG[jenis];
  const { data } = await locals.supabase
    .from(tabel)
    .select('id, kunci, nama_file, tipe')
    .eq('id', Number(id))
    .maybeSingle<{ id: number; kunci: string; nama_file: string; tipe: string }>();
  if (!data) error(404, 'Lampiran tidak ditemukan.');
  return { tabel, row: data };
}

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const { row } = await baca(locals, params.jenis, params.id);
  let target: string;
  try {
    target = await presignDownload(row.kunci, row.nama_file, bisaDilihat(row.tipe) && !url.searchParams.has('unduh'));
  } catch (e) {
    error(e instanceof StorageNotConfigured ? 503 : 502, 'Penyimpanan dokumen tidak dapat dihubungi.');
  }
  redirect(303, target);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const { tabel, row } = await baca(locals, params.jenis, params.id);
  const { data, error: err } = await locals.supabase.from(tabel).delete().eq('id', row.id).select('id');
  // RLS refuses a delete by deleting nothing.
  if (err || !data?.length) {
    return json(
      {
        message:
          params.jenis === 'periode'
            ? 'Lampiran laporan yang sudah disetujui tidak dapat dihapus.'
            : 'Peran Anda tidak dapat menghapus lampiran ini.'
      },
      { status: 403 }
    );
  }
  await deleteObject(row.kunci).catch((e) => console.error('[lampiran] hapus objek:', row.kunci, e));
  return json({ ok: true });
};
