/**
 * Neon Object Storage (S3-compatible) for lampiran. Server only: the access
 * key never reaches a browser. The browser uploads and downloads through
 * short-lived presigned URLs this module signs, so file bytes never pass
 * through a Vercel function — whose request body is capped at ~4.5 MB.
 *
 * Read from `$env/dynamic/private` so a missing key fails one request with a
 * clear message instead of failing the build.
 */
import { AwsClient } from 'aws4fetch';
import { env } from '$env/dynamic/private';

export class StorageNotConfigured extends Error {
  constructor() {
    super('Penyimpanan dokumen belum dikonfigurasi (AWS_* / S3_BUCKET).');
  }
}

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

/** URL the browser PUTs the file to. Valid for `seconds`. */
export async function presignUpload(key: string, contentType: string, seconds = 600): Promise<string> {
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
  const { aws, base } = client();
  const disposition = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  const q = new URLSearchParams({ 'X-Amz-Expires': String(seconds), 'response-content-disposition': disposition });
  const signed = await aws.sign(`${objectUrl(base, key)}?${q}`, { aws: { signQuery: true } });
  return signed.url;
}

/** Size and type of an uploaded object, or null when it is not there. */
export async function headObject(key: string): Promise<{ size: number; type: string } | null> {
  const { aws, base } = client();
  const res = await aws.fetch(objectUrl(base, key), { method: 'HEAD' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HEAD ${res.status}`);
  return { size: Number(res.headers.get('content-length') ?? 0), type: res.headers.get('content-type') ?? '' };
}

export async function deleteObject(key: string): Promise<void> {
  const { aws, base } = client();
  const res = await aws.fetch(objectUrl(base, key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${res.status}`);
}
