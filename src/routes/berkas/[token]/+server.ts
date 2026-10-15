import { createReadStream, createWriteStream } from 'node:fs';
import { link, rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { error } from '@sveltejs/kit';
import { TIPE_DITERIMA, UKURAN_MAKS, ekstensi } from '$lib/lampiran';
import { StorageNotConfigured, ensureDir, localPath, readGrant } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/**
 * The local storage driver's half of a presigned URL (`$lib/server/storage`).
 *
 * The token is the permission: it names one key, one method and an expiry,
 * and was signed only after the caller's RLS let them see the parent record.
 * A session is still required on top (hooks.server.ts), so a URL that leaks
 * into a log is useless to anyone not logged in.
 */

function grantFor(token: string, method: 'PUT' | 'GET') {
  try {
    return readGrant(token, method);
  } catch (cause) {
    if (cause instanceof StorageNotConfigured) error(503, cause.message);
    throw cause;
  }
}

/**
 * Written to a temporary name and hard-linked into place, which fails when
 * the key already exists: a still-valid upload URL cannot replace a file
 * after `simpan` recorded its size.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
  const grant = grantFor(params.token, 'PUT');
  if (!grant) error(403, 'Tautan unggah tidak sah atau sudah kedaluwarsa.');
  if (!request.body) error(400, 'Berkas kosong.');

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > UKURAN_MAKS) error(413, 'Berkas lebih dari 20 MB.');

  const target = localPath(grant.k);
  const temp = `${target}.${crypto.randomUUID()}.part`;
  await ensureDir(target);

  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > UKURAN_MAKS) callback(new Error('terlalu besar'));
      else callback(null, chunk);
    }
  });

  try {
    await pipeline(
      Readable.fromWeb(request.body as import('node:stream/web').ReadableStream),
      limit,
      createWriteStream(temp, { flags: 'wx' })
    );
    await link(temp, target);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') error(409, 'Berkas ini sudah diunggah.');
    if (received > UKURAN_MAKS) error(413, 'Berkas lebih dari 20 MB.');
    console.error('[berkas] PUT:', (cause as Error).message);
    error(500, 'Berkas gagal disimpan.');
  } finally {
    await rm(temp, { force: true });
  }

  return new Response(null, { status: 200 });
};

export const GET: RequestHandler = async ({ params }) => {
  const grant = grantFor(params.token, 'GET');
  if (!grant) error(403, 'Tautan sudah kedaluwarsa. Buka lampiran dari halamannya lagi.');

  const file = localPath(grant.k);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    error(404, 'Berkas tidak ditemukan di penyimpanan.');
  }

  // The type comes from the extension the server chose, never from the
  // uploader — nothing uploaded can be served as HTML.
  const type = TIPE_DITERIMA[ekstensi(grant.k)] ?? 'application/octet-stream';
  const name = encodeURIComponent(grant.n ?? 'lampiran');

  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(size),
      'Content-Disposition': `${grant.i ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
      'Cache-Control': 'private, no-store'
    }
  });
};
