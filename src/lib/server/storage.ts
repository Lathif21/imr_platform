/**
 * Object storage for lampiran. Server only. Two drivers, one interface:
 *
 *   local  STORAGE_DIR set — files on the VPS disk (a Docker volume). URLs
 *          point at /berkas/<token>, signed here with HMAC; that route
 *          streams the bytes in and out.
 *   s3     otherwise — any S3-compatible bucket (Neon Object Storage, R2,
 *          MinIO). URLs are presigned for the bucket itself, so the bytes go
 *          browser ↔ bucket directly.
 *
 * Either way the browser uploads and downloads through short-lived signed
 * URLs this module issues, and only after the caller's RLS let them see the
 * parent record (routes/(app)/lampiran). Keys are generated server-side.
 *
 * Read from `$env/dynamic/private` so a missing key fails one request with a
 * clear message instead of failing the build.
 */
import crypto from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { env } from '$env/dynamic/private';

export class StorageNotConfigured extends Error {
  constructor() {
    // The user sees this sentence; the variable names go to the server log.
    super('Penyimpanan dokumen belum disiapkan di server. Hubungi admin sistem.');
    console.error(
      '[storage] isi STORAGE_DIR (disk lokal), atau AWS_ENDPOINT_URL_S3 / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET.'
    );
  }
}

// ---------------------------------------------------------------------------
// Local driver
// ---------------------------------------------------------------------------

/** entity uuid / jenis / parent id or uuid / random uuid . ext — see routes/(app)/lampiran. */
const KEY_PATTERN = /^[0-9a-f-]{36}\/[a-z]+\/[0-9a-f-]{1,36}\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;

const isLocal = () => Boolean(env.STORAGE_DIR);

/** Absolute path of a key, refusing anything that would land outside STORAGE_DIR. */
export function localPath(key: string): string {
  if (!env.STORAGE_DIR) throw new StorageNotConfigured();
  if (!KEY_PATTERN.test(key)) throw new Error('kunci berkas tidak sah');
  const root = resolve(env.STORAGE_DIR);
  const full = resolve(root, key);
  if (!full.startsWith(root + sep)) throw new Error('kunci berkas keluar dari STORAGE_DIR');
  return full;
}

export interface BerkasGrant {
  /** Object key. */
  k: string;
  m: 'PUT' | 'GET';
  /** Expiry, epoch seconds. */
  e: number;
  /** GET: file name for Content-Disposition, and whether to open inline. */
  n?: string;
  i?: boolean;
}

/** Derived from JWT_SECRET, so a deployment has one secret less to manage. */
function grantKey(): Buffer {
  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new StorageNotConfigured();
  return crypto.createHmac('sha256', secret).update('imr-berkas-v1').digest();
}

function signGrant(grant: BerkasGrant): string {
  const body = Buffer.from(JSON.stringify(grant)).toString('base64url');
  const mac = crypto.createHmac('sha256', grantKey()).update(body).digest('base64url');
  return `/berkas/${body}.${mac}`;
}

/** The grant a /berkas token carries, or null when forged or expired. */
export function readGrant(token: string, method: 'PUT' | 'GET'): BerkasGrant | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', grantKey()).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const grant = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as BerkasGrant;
    if (grant.m !== method || !(grant.e > Date.now() / 1000) || !KEY_PATTERN.test(grant.k)) return null;
    return grant;
  } catch {
    return null;
  }
}

export async function ensureDir(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
}

// ---------------------------------------------------------------------------
// S3 driver
// ---------------------------------------------------------------------------

function client(): { aws: AwsClient; base: string } {
  const { AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET } = env;
  if (!AWS_ENDPOINT_URL_S3 || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !S3_BUCKET) {
    throw new StorageNotConfigured();
  }
  return {
    aws: new AwsClient({
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
      region: AWS_REGION || 'auto',
      service: 's3'
    }),
    base: `${AWS_ENDPOINT_URL_S3.replace(/\/$/, '')}/${S3_BUCKET}`
  };
}

const objectUrl = (base: string, key: string) =>
  `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

const expiry = (seconds: number) => Math.floor(Date.now() / 1000) + seconds;

/** URL the browser PUTs the file to. Valid for `seconds`. */
export async function presignUpload(key: string, contentType: string, seconds = 600): Promise<string> {
  if (isLocal()) {
    localPath(key);
    return signGrant({ k: key, m: 'PUT', e: expiry(seconds) });
  }
  const { aws, base } = client();
  const signed = await aws.sign(`${objectUrl(base, key)}?X-Amz-Expires=${seconds}`, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    aws: { signQuery: true }
  });
  return signed.url;
}

/**
 * URL that serves the file once, under its original name. `inline` opens a
 * PDF or photo in the browser tab; otherwise it downloads.
 */
export async function presignDownload(key: string, fileName: string, inline: boolean, seconds = 120): Promise<string> {
  if (isLocal()) {
    localPath(key);
    return signGrant({ k: key, m: 'GET', e: expiry(seconds), n: fileName, i: inline });
  }
  const { aws, base } = client();
  const disposition = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  const q = new URLSearchParams({ 'X-Amz-Expires': String(seconds), 'response-content-disposition': disposition });
  const signed = await aws.sign(`${objectUrl(base, key)}?${q}`, { aws: { signQuery: true } });
  return signed.url;
}

/** Size of an uploaded object, or null when it is not there. */
export async function headObject(key: string): Promise<{ size: number } | null> {
  if (isLocal()) {
    try {
      return { size: (await stat(localPath(key))).size };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    }
  }
  const { aws, base } = client();
  const res = await aws.fetch(objectUrl(base, key), { method: 'HEAD' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HEAD ${res.status}`);
  return { size: Number(res.headers.get('content-length') ?? 0) };
}

export async function deleteObject(key: string): Promise<void> {
  if (isLocal()) {
    await rm(localPath(key), { force: true });
    return;
  }
  const { aws, base } = client();
  const res = await aws.fetch(objectUrl(base, key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${res.status}`);
}
