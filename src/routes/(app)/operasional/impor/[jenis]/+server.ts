import { error, json } from '@sveltejs/kit';
import { UKURAN_IMPOR_MAKS, isJenisImpor, type PilihanDuplikat, type Pratinjau } from '$lib/impor';
import { periodeDari } from '$lib/operasional/kegiatan';
import { canReadOperational, canWriteOperational } from '$lib/roles';
import { bacaBerkas, buatTemplate } from '$lib/server/impor/excel';
import { IMPOR, type Konteks } from '$lib/server/impor/jenis';
import { explainDbError, loadOperationalEntities } from '$lib/server/operasional';
import type { RequestHandler } from './$types';

/**
 * Impor Excel for one kind of data.
 *
 *   GET                         the template for the entity (and month) on screen
 *   GET ?isi=1                  "Ekspor": the same template filled with the
 *                               screen's data, ready to edit and upload back
 *   POST langkah=pratinjau      check every row of the uploaded file
 *   POST langkah=simpan         check again — nothing from the browser's
 *                               preview is trusted — then save all rows in
 *                               one transaction (impor_* SQL functions)
 *
 * The file travels with both POSTs; the server keeps nothing between them.
 */

async function konteks(locals: App.Locals, url: URL): Promise<Konteks> {
  const { selected } = await loadOperationalEntities(locals.supabase, url.searchParams.get('entitas'));
  if (!selected) error(403, 'Akun Anda belum ditautkan ke entitas mana pun.');
  return { db: locals.supabase, entity: selected, periode: periodeDari(url) };
}

export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!canReadOperational(locals.role)) error(403, 'Peran Anda tidak membaca data operasional.');
  if (!isJenisImpor(params.jenis)) error(404, 'Template tidak dikenal.');
  const def = IMPOR[params.jenis];
  const k = await konteks(locals, url);

  const ekspor = url.searchParams.get('isi') === '1';
  const baris = ekspor ? await def.ekspor(k) : [];
  const isi = await buatTemplate(params.jenis, def, k, baris);
  const perBulan = def.perBulan || (ekspor && def.eksporBulanan);
  const bulan = perBulan ? ` ${k.periode.tahun}-${String(k.periode.bulan).padStart(2, '0')}` : '';
  const berkas = `${ekspor ? 'Data' : 'Template'} ${def.label} ${k.entity.code}${bulan}.xlsx`.replace(/[()]/g, '');
  return new Response(new Uint8Array(isi), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${berkas}"`,
      'cache-control': 'no-store'
    }
  });
};

export const POST: RequestHandler = async ({ locals, params, url, request }) => {
  if (!canWriteOperational(locals.role)) return json({ message: 'Peran Anda tidak dapat menambah data operasional.' }, { status: 403 });
  if (!isJenisImpor(params.jenis)) return json({ message: 'Jenis impor tidak dikenal.' }, { status: 404 });
  const jenis = params.jenis;
  const def = IMPOR[jenis];
  const k = await konteks(locals, url);

  const form = await request.formData().catch(() => null);
  const file = form?.get('berkas');
  if (!(file instanceof File) || file.size === 0) return json({ message: 'Pilih file Excel template yang sudah diisi.' }, { status: 400 });
  if (file.size > UKURAN_IMPOR_MAKS) return json({ message: 'File lebih dari 4 MB. Pecah menjadi beberapa file.' }, { status: 400 });

  const { rows, galatBerkas } = await bacaBerkas(jenis, def, await file.arrayBuffer());
  const hasil = galatBerkas.length ? null : await def.periksa(rows, k);
  const pratinjau: Pratinjau = { jenis, label: def.label, kolom: hasil?.kolom ?? [], baris: hasil?.baris ?? [], galatBerkas };

  if (form?.get('langkah') !== 'simpan') return json(pratinjau);

  // --- simpan ---------------------------------------------------------------
  const adaGalat = galatBerkas.length > 0 || pratinjau.baris.some((b) => b.galat.length > 0);
  if (!hasil || adaGalat) {
    return json({ message: 'File masih berisi baris yang salah. Perbaiki lalu unggah ulang.', pratinjau }, { status: 400 });
  }
  let pilihan: Record<number, PilihanDuplikat> = {};
  try {
    pilihan = JSON.parse(String(form?.get('pilihan') ?? '{}'));
  } catch {
    return json({ message: 'Pilihan duplikat tidak terbaca.' }, { status: 400 });
  }
  const belum = pratinjau.baris.filter((b) => b.duplikat?.bisaTimpa && !pilihan[b.baris]);
  if (belum.length) {
    return json({ message: `Pilih "data lama" atau "data baru" untuk baris ${belum.map((b) => b.baris).join(', ')}.` }, { status: 400 });
  }

  const { data, error: err } = await locals.supabase.rpc(def.rpc, hasil.payload(pilihan));
  if (err) {
    const pesan = explainDbError(def.rpc, err, { fallback: 'Impor gagal.' });
    return json({ message: `${pesan} Tidak ada data yang disimpan.` }, { status: 400 });
  }
  return json({ disimpan: Number(data ?? 0) });
};
