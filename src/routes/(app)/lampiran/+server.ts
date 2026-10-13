import { json } from '@sveltejs/kit';
import { TIPE_DITERIMA, UKURAN_MAKS, ekstensi, isJenisLampiran, tolakBerkas, type JenisLampiran } from '$lib/lampiran';
import { KONFIG, bacaRef, bolehUnggah, daftarLampiran, entitasInduk } from '$lib/server/lampiran';
import { StorageNotConfigured, deleteObject, headObject, presignUpload } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/**
 * Lampiran of one parent record.
 *
 *   GET  ?jenis=&ref=                         the list
 *   POST { langkah: 'minta',  jenis, ref, nama, ukuran }   → { kunci, url, tipe }
 *   POST { langkah: 'simpan', jenis, ref, kunci, nama }    → the saved row
 *
 * Upload is two steps so the bytes go browser → storage directly (no Vercel
 * body limit): `minta` signs a PUT for a key under the parent's own prefix,
 * `simpan` checks the object really arrived and records it. The record is
 * written with the caller's client, so RLS has the last word; a refused
 * record takes its object with it.
 */

const gagal = (status: number, message: string) => json({ message }, { status });

function bacaJenisRef(jenis: unknown, ref: unknown): { jenis: JenisLampiran; ref: string | number } | null {
  const j = String(jenis ?? '');
  if (!isJenisLampiran(j)) return null;
  const r = bacaRef(j, ref);
  return r === null ? null : { jenis: j, ref: r };
}

export const GET: RequestHandler = async ({ locals, url }) => {
  const p = bacaJenisRef(url.searchParams.get('jenis'), url.searchParams.get('ref'));
  if (!p) return gagal(400, 'Permintaan lampiran tidak valid.');
  try {
    return json({ lampiran: await daftarLampiran(locals.supabase, p.jenis, p.ref) });
  } catch {
    return gagal(500, 'Daftar lampiran gagal dimuat.');
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const p = bacaJenisRef(body?.jenis, body?.ref);
  if (!body || !p) return gagal(400, 'Permintaan lampiran tidak valid.');
  if (!bolehUnggah(locals.role, p.jenis)) return gagal(403, 'Peran Anda tidak dapat menambah lampiran di sini.');

  const entityId = await entitasInduk(locals.supabase, p.jenis, p.ref);
  if (!entityId) return gagal(404, 'Data yang dilampiri tidak ditemukan.');
  const prefix = `${entityId}/${p.jenis}/${p.ref}/`;
  const nama = String(body.nama ?? '').trim().slice(0, 255);

  try {
    if (body.langkah === 'minta') {
      const alasan = tolakBerkas(nama, Number(body.ukuran));
      if (alasan) return gagal(400, alasan);
      const ext = ekstensi(nama);
      const kunci = `${prefix}${crypto.randomUUID()}.${ext}`;
      const tipe = TIPE_DITERIMA[ext];
      return json({ kunci, tipe, url: await presignUpload(kunci, tipe) });
    }

    if (body.langkah === 'simpan') {
      const kunci = String(body.kunci ?? '');
      // Only a key this parent was given: no attaching someone else's object.
      if (!kunci.startsWith(prefix) || !/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(kunci.slice(prefix.length))) {
        return gagal(400, 'Kunci berkas tidak cocok dengan data yang dilampiri.');
      }
      const ext = ekstensi(kunci);
      if (tolakBerkas(nama, 1) || ekstensi(nama) !== ext) return gagal(400, 'Nama berkas tidak cocok.');

      const obj = await headObject(kunci);
      if (!obj) return gagal(400, `${nama}: berkas belum sampai di penyimpanan. Coba unggah lagi.`);
      if (obj.size > UKURAN_MAKS) {
        await deleteObject(kunci);
        return gagal(400, `${nama}: lebih dari 20 MB.`);
      }

      const { tabel, kolom } = KONFIG[p.jenis];
      const { data, error } = await locals.supabase
        .from(tabel)
        .insert({ entity_id: entityId, [kolom]: p.ref, nama_file: nama, tipe: TIPE_DITERIMA[ext], ukuran: obj.size, kunci })
        .select('id')
        .single<{ id: number }>();
      if (error || !data) {
        await deleteObject(kunci).catch(() => {});
        console.error('[lampiran] insert:', error?.code, error?.message);
        return gagal(403, 'Lampiran ditolak: Anda tidak dapat menambah lampiran pada data ini.');
      }
      return json({ id: data.id });
    }
  } catch (e) {
    if (e instanceof StorageNotConfigured) return gagal(503, e.message);
    console.error('[lampiran]', e);
    return gagal(502, 'Penyimpanan dokumen tidak dapat dihubungi. Coba lagi sebentar.');
  }

  return gagal(400, 'Langkah unggah tidak dikenal.');
};
