import type { Actions, PageServerLoad } from './$types';
import { periodeDari, rentangBulan } from '$lib/operasional/kegiatan';
import {
  ISO_DATE,
  explainDbError,
  failLoad,
  idFrom,
  invalid,
  optionalText,
  refuse,
  requiredText
} from '$lib/server/operasional';

/**
 * Database General — one row per kegiatan kapal in the month.
 *
 * Laravel built these rows by joining rekap and transaksi on
 * `kapal_id___rute` with a fuzzy fallback, and showed a separate kind of row
 * for trucks with no kegiatan. Here every truck belongs to a kegiatan
 * (simpan_rincian_kegiatan, migration 20250113), so a row is a kegiatan and
 * nothing is matched by name. Trucks without a kegiatan can only come from a
 * data migration; they are counted and reported, not hidden.
 */
export interface KegiatanRow {
  id: number;
  kapal_id: number;
  nama_kapal: string;
  rute: string | null;
  tanggal_input: string | null;
  tanggal_kegiatan: string | null;
  tanggal_selesai: string | null;
  keterangan: string | null;
  trips: number;
  tonase: number;
  jumlah_truk: number;
  pemilik: string[];
}

interface RekapRecord {
  id: number;
  kapal_id: number;
  rute: string | null;
  trips: number | null;
  tonase: string | null;
  tanggal_input: string | null;
  tanggal_kegiatan: string | null;
  tanggal_selesai: string | null;
  keterangan: string | null;
}

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  const kosong = {
    periode,
    kegiatan: [] as KegiatanRow[],
    daftarKapal: [] as string[],
    trukTanpaKegiatan: 0,
    bukaTambah: url.searchParams.has('tambah')
  };
  if (!opEntity) return kosong;

  const { dari, sampai } = rentangBulan(periode);
  const db = locals.supabase;

  const [rekapResult, kapalResult, transaksiResult, kendaraanResult, pemilikResult] = await Promise.all([
    db
      .from('operasional_rekap')
      .select('id, kapal_id, rute, trips, tonase, tanggal_input, tanggal_kegiatan, tanggal_selesai, keterangan')
      .eq('entity_id', opEntity.id)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .order('id', { ascending: false })
      .returns<RekapRecord[]>(),
    db
      .from('kapal')
      .select('id, nama_kapal')
      .eq('entity_id', opEntity.id)
      .order('nama_kapal')
      .returns<{ id: number; nama_kapal: string }[]>(),
    db
      .from('transaksi_operasional')
      .select('operasional_rekap_id, kendaraan_id')
      .eq('entity_id', opEntity.id)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .returns<{ operasional_rekap_id: number | null; kendaraan_id: number | null }[]>(),
    db
      .from('kendaraan')
      .select('id, pemilik_id')
      .eq('entity_id', opEntity.id)
      .returns<{ id: number; pemilik_id: number }[]>(),
    db
      .from('pemilik')
      .select('id, nama_pemilik')
      .eq('entity_id', opEntity.id)
      .returns<{ id: number; nama_pemilik: string }[]>()
  ]);

  if (rekapResult.error) failLoad('operasional_rekap', rekapResult.error);
  if (kapalResult.error) failLoad('kapal', kapalResult.error);
  if (transaksiResult.error) failLoad('transaksi_operasional', transaksiResult.error);
  if (kendaraanResult.error) failLoad('kendaraan', kendaraanResult.error);
  if (pemilikResult.error) failLoad('pemilik', pemilikResult.error);

  const namaKapal = new Map((kapalResult.data ?? []).map((k) => [k.id, k.nama_kapal]));
  const namaPemilik = new Map((pemilikResult.data ?? []).map((p) => [p.id, p.nama_pemilik]));
  const pemilikTruk = new Map((kendaraanResult.data ?? []).map((k) => [k.id, namaPemilik.get(k.pemilik_id)]));

  const trukPerKegiatan = new Map<number, { jumlah: number; pemilik: Set<string> }>();
  let trukTanpaKegiatan = 0;
  for (const t of transaksiResult.data ?? []) {
    if (t.operasional_rekap_id === null) {
      trukTanpaKegiatan += 1;
      continue;
    }
    const entry = trukPerKegiatan.get(t.operasional_rekap_id) ?? { jumlah: 0, pemilik: new Set<string>() };
    entry.jumlah += 1;
    const pemilik = t.kendaraan_id === null ? undefined : pemilikTruk.get(t.kendaraan_id);
    if (pemilik) entry.pemilik.add(pemilik);
    trukPerKegiatan.set(t.operasional_rekap_id, entry);
  }

  return {
    ...kosong,
    trukTanpaKegiatan,
    daftarKapal: (kapalResult.data ?? []).map((k) => k.nama_kapal),
    kegiatan: (rekapResult.data ?? []).map((r) => {
      const truk = trukPerKegiatan.get(r.id);
      return {
        id: r.id,
        kapal_id: r.kapal_id,
        nama_kapal: namaKapal.get(r.kapal_id) ?? '—',
        rute: r.rute,
        tanggal_input: r.tanggal_input,
        tanggal_kegiatan: r.tanggal_kegiatan,
        tanggal_selesai: r.tanggal_selesai,
        keterangan: r.keterangan,
        trips: r.trips ?? 0,
        tonase: Number(r.tonase ?? 0),
        jumlah_truk: truk?.jumlah ?? 0,
        pemilik: [...(truk?.pemilik ?? [])].sort()
      } satisfies KegiatanRow;
    })
  };
};

/**
 * The fields shared by Tambah and Ubah, read and checked together so the
 * error modal lists every problem at once.
 */
function bacaKegiatan(form: FormData) {
  const namaKapal = requiredText(form, 'nama_kapal').replace(/\s+/g, ' ');
  const bulan = Number(requiredText(form, 'bulan'));
  const tahun = Number(requiredText(form, 'tahun'));
  const tanggalInput = optionalText(form, 'tanggal_input');
  const tanggalKegiatan = optionalText(form, 'tanggal_kegiatan');
  const tanggalSelesai = optionalText(form, 'tanggal_selesai');

  const details: string[] = [];
  if (namaKapal === '') details.push('Nama kapal / VOY wajib diisi.');
  if (namaKapal.length > 255) details.push('Nama kapal maksimal 255 karakter.');
  if (!Number.isInteger(bulan) || bulan < 1 || bulan > 12) details.push('Bulan pengiriman wajib dipilih.');
  if (!Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) details.push('Tahun tidak sah.');
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

  return { details, namaKapal, bulan, tahun, tanggalInput, tanggalKegiatan, tanggalSelesai };
}

export const actions: Actions = {
  tambah: async ({ locals, request }) => {
    const form = await request.formData();
    const k = bacaKegiatan(form);
    if (k.details.length) return invalid(k.details);

    const { error } = await locals.supabase.rpc('tambah_kegiatan', {
      p_entity_id: requiredText(form, 'entity_id'),
      p_nama_kapal: k.namaKapal,
      p_bulan: k.bulan,
      p_tahun: k.tahun,
      p_tanggal_input: k.tanggalInput,
      p_tanggal_kegiatan: k.tanggalKegiatan,
      p_tanggal_selesai: k.tanggalSelesai,
      p_keterangan: optionalText(form, 'keterangan')
    });
    if (error) return refuse(explainDbError('tambah_kegiatan', error, { fallback: 'Data kapal gagal ditambahkan.' }));

    return {
      title: 'Berhasil disimpan',
      message: `Kegiatan ${k.namaKapal} berhasil ditambahkan. Lanjutkan dengan "Lengkapi Data" untuk mengisi rute, truk, dan biayanya.`
    };
  },

  ubah: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    const k = bacaKegiatan(form);
    if (id === null) k.details.unshift('Kegiatan yang akan diubah tidak dikenali.');
    if (k.details.length) return invalid(k.details);

    const { error } = await locals.supabase.rpc('ubah_kegiatan', {
      p_rekap_id: id,
      p_nama_kapal: k.namaKapal,
      p_bulan: k.bulan,
      p_tahun: k.tahun,
      p_tanggal_input: k.tanggalInput,
      p_tanggal_kegiatan: k.tanggalKegiatan,
      p_tanggal_selesai: k.tanggalSelesai
    });
    if (error) return refuse(explainDbError('ubah_kegiatan', error, { fallback: 'Data kapal gagal diperbarui.' }));

    return { title: 'Berhasil diperbarui', message: `Data kegiatan ${k.namaKapal} berhasil diperbarui.` };
  },

  /**
   * Laravel (OperasionalController::destroy) deleted the kegiatan, its
   * trucks, its telly pay, and — by fuzzy name match — every revenue row of
   * the month whose activity name contained the ship's name. The first three
   * follow here by FK cascade (migration 20250113). The revenue rows do not:
   * they are invoices entered by hand, and a name match deleted other ships'
   * invoices too.
   */
  hapus: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    if (id === null) return refuse('Kegiatan yang akan dihapus tidak dikenali.');

    const { data, error } = await locals.supabase.from('operasional_rekap').delete().eq('id', id).select('id');
    if (error) return refuse(explainDbError('hapus kegiatan', error, { fallback: 'Data kegiatan gagal dihapus.' }));
    if (!data?.length) return refuse('Data kegiatan tidak ditemukan, atau Anda tidak berwenang menghapusnya.');

    return {
      title: 'Berhasil dihapus',
      message: 'Kegiatan kapal beserta rincian truk, iuran paguyuban, dan honor telly-nya berhasil dihapus.'
    };
  }
};
