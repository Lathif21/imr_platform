import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { bacaAngka, bacaRupiah, susunRute } from '$lib/operasional/kegiatan';
import { muatKegiatan } from '$lib/server/kegiatan';
import { ISO_DATE, explainDbError, failLoad, invalid, optionalText, refuse, requiredText } from '$lib/server/operasional';

/**
 * Lengkapi Data Kegiatan — OperasionalController::editKegiatan/updateKegiatan.
 *
 * The page only reads. Laravel's version of this page CREATED a kegiatan on
 * GET when opened with a kapal and route that had none; here a kegiatan is
 * created only by "Tambah Data General", and this page opens one by id.
 */

export interface TrukRow {
  nopol: string;
  ritase: number;
  tonase: number;
}

export const load: PageServerLoad = async ({ locals, parent, params }) => {
  const { opEntity } = await parent();
  if (!opEntity) error(404, 'Kegiatan tidak ditemukan.');
  const db = locals.supabase;

  const kegiatan = await muatKegiatan(db, params.id, opEntity.id);

  const [transaksiResult, kendaraanResult, pemilikResult, karyawanResult] = await Promise.all([
    db
      .from('transaksi_operasional')
      .select('kendaraan_id, ritase, tonase')
      .eq('operasional_rekap_id', kegiatan.id)
      .order('id')
      .returns<{ kendaraan_id: number | null; ritase: number; tonase: string }[]>(),
    db
      .from('kendaraan')
      .select('id, nopol, pemilik_id')
      .eq('entity_id', opEntity.id)
      .order('nopol')
      .returns<{ id: number; nopol: string; pemilik_id: number }[]>(),
    db
      .from('pemilik')
      .select('id, nama_pemilik')
      .eq('entity_id', opEntity.id)
      .order('nama_pemilik')
      .returns<{ id: number; nama_pemilik: string }[]>(),
    db
      .from('karyawan')
      .select('id, nama, jabatan, status')
      .eq('entity_id', opEntity.id)
      .order('nama')
      .returns<{ id: number; nama: string; jabatan: string | null; status: string }[]>()
  ]);

  if (transaksiResult.error) failLoad('transaksi_operasional', transaksiResult.error);
  if (kendaraanResult.error) failLoad('kendaraan', kendaraanResult.error);
  if (pemilikResult.error) failLoad('pemilik', pemilikResult.error);
  if (karyawanResult.error) failLoad('karyawan', karyawanResult.error);

  const kendaraan = kendaraanResult.data ?? [];
  const nopolById = new Map(kendaraan.map((k) => [k.id, k.nopol]));

  return {
    kegiatan,
    truk: (transaksiResult.data ?? []).map(
      (t): TrukRow => ({
        nopol: t.kendaraan_id === null ? '' : (nopolById.get(t.kendaraan_id) ?? ''),
        ritase: t.ritase,
        tonase: Number(t.tonase)
      })
    ),
    kendaraan: kendaraan.map((k) => ({ nopol: k.nopol, pemilik_id: k.pemilik_id })),
    pemilik: (pemilikResult.data ?? []).map((p) => ({ id: p.id, nama: p.nama_pemilik })),
    // Laravel listed every employee. Inactive ones are left out, except the
    // one already assigned, so an old kegiatan still shows its telly.
    telly: (karyawanResult.data ?? [])
      .filter((k) => k.status === 'aktif' || k.id === kegiatan.telly_id)
      .map((k) => ({ id: k.id, nama: k.nama, jabatan: k.jabatan }))
  };
};

interface TrukInput {
  nopol?: unknown;
  pemilik_id?: unknown;
  pemilik_baru?: unknown;
  ritase?: unknown;
  tonase?: unknown;
}

const normalNopol = (raw: string) => raw.trim().replace(/\s+/g, ' ').toUpperCase();

export const actions: Actions = {
  simpan: async ({ locals, request, params }) => {
    const form = await request.formData();
    const details: string[] = [];

    const operasional = bacaRupiah(String(form.get('operasional') ?? ''));
    if (operasional === null) details.push('Biaya operasional harus berupa angka rupiah, mis. 1.250.000.');

    const tellyRaw = optionalText(form, 'telly_id');
    const tellyId = tellyRaw === null ? null : Number(tellyRaw);
    if (tellyId !== null && !Number.isInteger(tellyId)) details.push('Petugas telly tidak dikenali.');

    const tanggalInput = optionalText(form, 'tanggal_input');
    const tanggalKegiatan = optionalText(form, 'tanggal_kegiatan');
    const tanggalSelesai = optionalText(form, 'tanggal_selesai');
    for (const [label, value] of [
      ['Tanggal input', tanggalInput],
      ['Tanggal kegiatan', tanggalKegiatan],
      ['Tanggal selesai', tanggalSelesai]
    ] as const) {
      if (value !== null && !ISO_DATE.test(value)) details.push(`${label} tidak sah.`);
    }
    if (tanggalKegiatan && tanggalSelesai && tanggalSelesai < tanggalKegiatan) {
      details.push('Tanggal selesai tidak boleh sebelum tanggal kegiatan.');
    }

    let raw: TrukInput[] = [];
    try {
      const parsed = JSON.parse(String(form.get('truk') ?? '[]'));
      if (Array.isArray(parsed)) raw = parsed;
      else details.push('Daftar truk tidak terbaca. Muat ulang halaman lalu coba lagi.');
    } catch {
      details.push('Daftar truk tidak terbaca. Muat ulang halaman lalu coba lagi.');
    }

    // Unknown plates need an owner. Checked here as well as in the database
    // so the modal lists every such truck, not just the first.
    const { data: terdaftar } = await locals.supabase
      .from('kendaraan')
      .select('nopol')
      .eq('entity_id', requiredText(form, 'entity_id'))
      .returns<{ nopol: string }[]>();
    const sudahAda = new Set((terdaftar ?? []).map((k) => normalNopol(k.nopol)));

    const truk: { nopol: string; pemilik_id: number | null; pemilik_baru: string; ritase: number; tonase: number }[] = [];
    const dilihat = new Set<string>();
    raw.forEach((item, i) => {
      const no = i + 1;
      const nopol = normalNopol(String(item.nopol ?? ''));
      const ritaseText = String(item.ritase ?? '').trim();
      const tonaseText = String(item.tonase ?? '');
      if (nopol === '' && ritaseText === '' && tonaseText.trim() === '') return; // baris kosong

      if (nopol === '') {
        details.push(`Truk baris ${no}: plat nomor wajib diisi.`);
        return;
      }
      if (dilihat.has(nopol)) details.push(`Truk ${nopol} tercantum lebih dari sekali.`);
      dilihat.add(nopol);

      const ritase = ritaseText === '' ? 0 : Number(ritaseText);
      if (!Number.isInteger(ritase) || ritase < 0) details.push(`Truk ${nopol}: ritase harus bilangan bulat 0 atau lebih.`);
      const tonase = bacaAngka(tonaseText);
      if (tonase === null) details.push(`Truk ${nopol}: tonase harus angka 0 atau lebih, mis. 12,5.`);

      const pemilikId = /^\d+$/.test(String(item.pemilik_id ?? '')) ? Number(item.pemilik_id) : null;
      const pemilikBaru = String(item.pemilik_baru ?? '').trim();
      if (!sudahAda.has(nopol) && pemilikId === null && pemilikBaru === '') {
        details.push(`Truk ${nopol} belum terdaftar: pilih pemiliknya atau isi nama pemilik baru.`);
      }

      truk.push({ nopol, pemilik_id: pemilikId, pemilik_baru: pemilikBaru, ritase, tonase: tonase ?? 0 });
    });

    if (details.length) return invalid(details);

    const { error: err } = await locals.supabase.rpc('simpan_rincian_kegiatan', {
      p_rekap_id: Number(params.id),
      p_rute: susunRute(String(form.get('rute_asal') ?? ''), String(form.get('rute_tujuan') ?? '')),
      p_operasional: operasional,
      p_telly_id: tellyId,
      p_tanggal_input: tanggalInput,
      p_tanggal_kegiatan: tanggalKegiatan,
      p_tanggal_selesai: tanggalSelesai,
      p_keterangan: optionalText(form, 'keterangan'),
      p_truk: truk
    });
    if (err) {
      return refuse(
        explainDbError('simpan_rincian_kegiatan', err, {
          duplicate: 'Ada truk yang tercantum lebih dari sekali pada kegiatan ini.',
          fallback: 'Detail kegiatan gagal disimpan.'
        })
      );
    }

    return {
      title: 'Berhasil disimpan',
      message: `Detail kegiatan kapal & ${truk.length} armada truk berhasil disimpan.`
    };
  }
};
