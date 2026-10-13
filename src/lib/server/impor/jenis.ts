/**
 * The seven import templates: their columns, and how a filled-in file is
 * checked and saved. The checks repeat the manual forms' rules so an import
 * cannot store what the form would refuse; saving goes through the
 * impor_* SQL functions (20250120000000_impor_excel.sql), one transaction
 * each — all rows or none.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BarisPratinjau, JenisImpor, PilihanDuplikat } from '$lib/impor';
import { NAMA_BULAN, pecahRute, rentangBulan, susunRute, type Periode } from '$lib/operasional/kegiatan';
import { STATUS_ENTRY, TARIF_PAJAK } from '$lib/operasional/pendapatan';
import { rupiah as rp } from '$lib/operasional/ui';
import type { OperationalEntity } from '../operasional';
import { banding, bulat, desimal, normalNopol, rupiah, tanggal, teks } from './sel';

export type TipeKolom = 'teks' | 'tanggal' | 'rupiah' | 'desimal' | 'bulat';

export interface Kolom {
  judul: string;
  kunci: string;
  tipe: TipeKolom;
  wajib?: boolean;
  catatan?: string;
  contoh?: string | number;
  lebar?: number;
  /** Dropdown in the template. `ketat` refuses anything else; otherwise it only suggests. */
  daftar?: { kunci: string; ketat?: boolean };
}

export interface Konteks {
  db: SupabaseClient;
  entity: OperationalEntity;
  periode: Periode;
}

export interface BarisMentah {
  baris: number;
  nilai: Record<string, unknown>;
}

export interface HasilPeriksa {
  kolom: string[];
  baris: BarisPratinjau[];
  /** The RPC arguments, given the admin's old/new choice per duplicate row. */
  payload: (pilihan: Record<number, PilihanDuplikat>) => Record<string, unknown>;
}

export interface DefImpor {
  label: string;
  rpc: string;
  kolom: Kolom[];
  petunjuk: string[];
  /** Lists for dropdowns, by Kolom.daftar.kunci. */
  daftar?: (k: Konteks) => Promise<Record<string, string[]>>;
  /** Pendapatan is for the month on screen; the others carry their own dates. */
  perBulan?: boolean;
  periksa: (rows: BarisMentah[], k: Konteks) => Promise<HasilPeriksa>;
  /**
   * "Ekspor": the data on the screen as template rows (values by Kolom.kunci,
   * dates as 'YYYY-MM-DD'), so the file can be edited and uploaded again.
   */
  ekspor: (k: Konteks) => Promise<BarisEkspor[]>;
  /** The screen shows one month, and so does its export. */
  eksporBulanan?: boolean;
}

export type BarisEkspor = Record<string, string | number | null>;

const angka = (v: string | number | null) => (v === null ? null : Number(v));

const tgl = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '');
const namaBulan = (iso: string) => `${NAMA_BULAN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/**
 * A date that lands outside the month on screen is allowed (the data simply
 * shows up under its own month), but it is how a date Excel read as
 * month/day shows itself — so the preview says so before saving.
 */
function bulanLain(iso: string | null, { bulan, tahun }: Periode): string | null {
  if (!iso || (Number(iso.slice(5, 7)) === bulan && Number(iso.slice(0, 4)) === tahun)) return null;
  return `Masuk ke bulan ${namaBulan(iso)}, bukan ${NAMA_BULAN[bulan - 1]} ${tahun} yang sedang dibuka. Pastikan tanggal ditulis dd/mm/yyyy.`;
}
const MAKS = 255;

function wajibTeks(row: BarisMentah, kunci: string, label: string, galat: string[]): string {
  const v = teks(row.nilai[kunci]);
  if (v === '') galat.push(`${label} wajib diisi.`);
  else if (v.length > MAKS) galat.push(`${label} maksimal ${MAKS} karakter.`);
  return v;
}

function opsiTeks(row: BarisMentah, kunci: string, label: string, galat: string[], maks = MAKS): string | null {
  const v = teks(row.nilai[kunci]);
  if (v.length > maks) galat.push(`${label} maksimal ${maks} karakter.`);
  return v === '' ? null : v;
}

function bacaTanggal(row: BarisMentah, kunci: string, label: string, galat: string[], wajib = false): string | null {
  const v = tanggal(row.nilai[kunci]);
  if (v === undefined) galat.push(`${label} tidak sah — tulis dd/mm/yyyy, mis. 05/12/2026.`);
  else if (v === null && wajib) galat.push(`${label} wajib diisi.`);
  return v ?? null;
}

function bacaRupiahKol(row: BarisMentah, kunci: string, label: string, galat: string[], wajib = false): number | null {
  const v = rupiah(row.nilai[kunci]);
  if (v === undefined) galat.push(`${label} harus angka rupiah, mis. 1.250.000.`);
  else if (v === null && wajib) galat.push(`${label} wajib diisi.`);
  return v ?? null;
}

/** Rows not chosen "lama", each carrying `timpa_id` when it overwrites. */
function pilihBaris<T extends { baris: number }>(
  rows: T[],
  timpa: Map<number, number>,
  pilihan: Record<number, PilihanDuplikat>
): (T & { timpa_id?: number })[] {
  return rows
    .filter((r) => !(timpa.has(r.baris) && pilihan[r.baris] !== 'baru'))
    .map((r) => (timpa.has(r.baris) ? { ...r, timpa_id: timpa.get(r.baris) } : r));
}

/** The same key twice in one file is a mistake in the file, not a duplicate to choose. */
function gandaDalamBerkas(baris: BarisPratinjau[], kunci: (string | null)[], label: string) {
  const pertama = new Map<string, number>();
  kunci.forEach((k, i) => {
    if (!k) return;
    const sebelum = pertama.get(k);
    if (sebelum !== undefined) baris[i].galat.push(`${label} sama dengan baris ${sebelum} di file ini.`);
    else pertama.set(k, baris[i].baris);
  });
}

// ---------------------------------------------------------------------------

const pengeluaran: DefImpor = {
  label: 'Pengeluaran',
  rpc: 'impor_pengeluaran',
  kolom: [
    { judul: 'Tanggal', kunci: 'tanggal', tipe: 'tanggal', wajib: true, contoh: '05/12/2026' },
    { judul: 'Jenis Pengeluaran', kunci: 'jenis', tipe: 'teks', wajib: true, contoh: 'Sewa Kantor', lebar: 26, daftar: { kunci: 'jenis' }, catatan: 'Pilih dari daftar, atau ketik jenis baru.' },
    { judul: 'Nama Pengeluaran / Kegiatan', kunci: 'nama_kegiatan', tipe: 'teks', contoh: 'Sewa Desember', lebar: 28 },
    { judul: 'Penerima', kunci: 'penerima', tipe: 'teks', contoh: 'Budi Santoso', lebar: 20 },
    { judul: 'Jumlah (Rp)', kunci: 'jumlah', tipe: 'rupiah', wajib: true, contoh: 1250000, lebar: 16 },
    { judul: 'Keterangan', kunci: 'keterangan', tipe: 'teks', lebar: 30 }
  ],
  petunjuk: ['Satu baris = satu pengeluaran.', 'Pengeluaran yang tanggal, jenis, nama, dan jumlahnya sama dengan data yang sudah ada akan ditandai sebagai duplikat.'],
  daftar: async ({ db, entity }) => {
    const [a, b] = await Promise.all([
      db.from('pengeluaran').select('jenis').eq('entity_id', entity.id).returns<{ jenis: string }[]>(),
      db
        .from('operational_expense_mapping')
        .select('jenis')
        .eq('entity_id', entity.id)
        .eq('source', 'pengeluaran')
        .returns<{ jenis: string }[]>()
    ]);
    const jenis = new Set([...(a.data ?? []).map((r) => r.jenis), ...(b.data ?? []).map((r) => r.jenis)]);
    return { jenis: [...jenis].filter(Boolean).sort((x, y) => x.localeCompare(y, 'id')) };
  },
  eksporBulanan: true,
  async ekspor({ db, entity, periode }) {
    const { dari, sampai } = rentangBulan(periode);
    const { data } = await db
      .from('pengeluaran')
      .select('tanggal, jenis, nama_kegiatan, penerima, jumlah, keterangan')
      .eq('entity_id', entity.id)
      .gte('tanggal', dari)
      .lt('tanggal', sampai)
      .order('tanggal')
      .order('id')
      .returns<{ tanggal: string; jenis: string; nama_kegiatan: string | null; penerima: string | null; jumlah: string; keterangan: string | null }[]>();
    return (data ?? []).map((r) => ({ ...r, jumlah: angka(r.jumlah) }));
  },
  async periksa(rows, { db, entity, periode }) {
    const data = rows.map((row) => {
      const galat: string[] = [];
      const v = {
        baris: row.baris,
        tanggal: bacaTanggal(row, 'tanggal', 'Tanggal', galat, true),
        jenis: wajibTeks(row, 'jenis', 'Jenis pengeluaran', galat),
        nama_kegiatan: opsiTeks(row, 'nama_kegiatan', 'Nama pengeluaran', galat),
        penerima: opsiTeks(row, 'penerima', 'Penerima', galat),
        jumlah: bacaRupiahKol(row, 'jumlah', 'Jumlah', galat, true),
        keterangan: opsiTeks(row, 'keterangan', 'Keterangan', galat, 2000)
      };
      return { v, galat };
    });

    const tanggalAda = data.map((d) => d.v.tanggal).filter((t): t is string => !!t).sort();
    const { data: ada } = tanggalAda.length
      ? await db
          .from('pengeluaran')
          .select('id, tanggal, jenis, nama_kegiatan, jumlah')
          .eq('entity_id', entity.id)
          .gte('tanggal', tanggalAda[0])
          .lte('tanggal', tanggalAda[tanggalAda.length - 1])
          .returns<{ id: number; tanggal: string; jenis: string; nama_kegiatan: string | null; jumlah: string }[]>()
      : { data: [] };
    const kunci = (t: string | null, j: string, n: string | null, x: number | null) => `${t}|${banding(j)}|${banding(n)}|${x}`;
    const peta = new Map((ada ?? []).map((p) => [kunci(p.tanggal, p.jenis, p.nama_kegiatan, Number(p.jumlah)), p.id]));

    const timpa = new Map<number, number>();
    const baris: BarisPratinjau[] = data.map(({ v, galat }) => {
      const b: BarisPratinjau = { baris: v.baris, tampil: [tgl(v.tanggal), v.jenis, v.nama_kegiatan ?? '', v.penerima ?? '', v.jumlah === null ? '' : rp(v.jumlah)], galat };
      const lain = bulanLain(v.tanggal, periode);
      if (lain) b.peringatan = [lain];
      const id = galat.length ? undefined : peta.get(kunci(v.tanggal, v.jenis, v.nama_kegiatan, v.jumlah));
      if (id !== undefined) {
        timpa.set(v.baris, id);
        b.duplikat = { keterangan: 'Pengeluaran yang sama sudah tercatat.', bisaTimpa: true };
      }
      return b;
    });
    return {
      kolom: ['Tanggal', 'Jenis', 'Nama', 'Penerima', 'Jumlah'],
      baris,
      payload: (pilihan) => ({ p_entity_id: entity.id, p_rows: pilihBaris(data.map((d) => d.v), timpa, pilihan) })
    };
  }
};

// ---------------------------------------------------------------------------

const pemilik: DefImpor = {
  label: 'Pemilik Kendaraan',
  rpc: 'impor_pemilik',
  kolom: [{ judul: 'Nama Pemilik', kunci: 'nama_pemilik', tipe: 'teks', wajib: true, contoh: 'H. Ahmad', lebar: 30 }],
  petunjuk: ['Satu baris = satu pemilik kendaraan.', 'Nama yang sudah terdaftar dilewati (tidak dibuat dua kali).'],
  async ekspor({ db, entity }) {
    const { data } = await db.from('pemilik').select('nama_pemilik').eq('entity_id', entity.id).order('nama_pemilik').returns<{ nama_pemilik: string }[]>();
    return data ?? [];
  },
  async periksa(rows, { db, entity }) {
    const data = rows.map((row) => {
      const galat: string[] = [];
      return { v: { baris: row.baris, nama_pemilik: wajibTeks(row, 'nama_pemilik', 'Nama pemilik', galat) }, galat };
    });
    const { data: ada } = await db.from('pemilik').select('id, nama_pemilik').eq('entity_id', entity.id).returns<{ id: number; nama_pemilik: string }[]>();
    const peta = new Map((ada ?? []).map((p) => [banding(p.nama_pemilik), p.id]));
    const timpa = new Map<number, number>();
    const baris = data.map(({ v, galat }) => {
      const b: BarisPratinjau = { baris: v.baris, tampil: [v.nama_pemilik], galat };
      const id = peta.get(banding(v.nama_pemilik));
      if (id !== undefined && !galat.length) {
        timpa.set(v.baris, id);
        b.duplikat = { keterangan: 'Sudah terdaftar — akan dilewati.', bisaTimpa: false };
      }
      return b;
    });
    gandaDalamBerkas(baris, data.map((d) => banding(d.v.nama_pemilik) || null), 'Nama pemilik');
    return { kolom: ['Nama Pemilik'], baris, payload: (pilihan) => ({ p_entity_id: entity.id, p_rows: pilihBaris(data.map((d) => d.v), timpa, pilihan) }) };
  }
};

// ---------------------------------------------------------------------------

const kendaraan: DefImpor = {
  label: 'Kendaraan',
  rpc: 'impor_kendaraan',
  kolom: [
    { judul: 'Nomor Polisi', kunci: 'nopol', tipe: 'teks', wajib: true, contoh: 'W 1234 AB', lebar: 16 },
    { judul: 'Nama Pemilik', kunci: 'pemilik', tipe: 'teks', wajib: true, contoh: 'H. Ahmad', lebar: 26, daftar: { kunci: 'pemilik' }, catatan: 'Pemilik baru otomatis dibuat.' },
    { judul: 'NPWP', kunci: 'npwp', tipe: 'teks', contoh: '00.000.000.0-000.000', lebar: 24 }
  ],
  petunjuk: ['Satu baris = satu truk.', 'Pemilik yang belum terdaftar otomatis ditambahkan ke menu Pemilik.'],
  async ekspor({ db, entity }) {
    const { data } = await db
      .from('v_kendaraan_ringkasan')
      .select('nopol, nama_pemilik, npwp')
      .eq('entity_id', entity.id)
      .order('nopol')
      .returns<{ nopol: string; nama_pemilik: string | null; npwp: string | null }[]>();
    return (data ?? []).map((r) => ({ nopol: r.nopol, pemilik: r.nama_pemilik, npwp: r.npwp }));
  },
  daftar: async ({ db, entity }) => {
    const { data } = await db.from('pemilik').select('nama_pemilik').eq('entity_id', entity.id).order('nama_pemilik').returns<{ nama_pemilik: string }[]>();
    return { pemilik: (data ?? []).map((p) => p.nama_pemilik) };
  },
  async periksa(rows, { db, entity }) {
    const data = rows.map((row) => {
      const galat: string[] = [];
      const v = {
        baris: row.baris,
        nopol: normalNopol(wajibTeks(row, 'nopol', 'Nomor polisi', galat)),
        pemilik: wajibTeks(row, 'pemilik', 'Nama pemilik', galat),
        npwp: opsiTeks(row, 'npwp', 'NPWP', galat)
      };
      return { v, galat };
    });
    const { data: ada } = await db
      .from('v_kendaraan_ringkasan')
      .select('id, nopol, nama_pemilik')
      .eq('entity_id', entity.id)
      .returns<{ id: number; nopol: string; nama_pemilik: string | null }[]>();
    const peta = new Map((ada ?? []).map((k) => [normalNopol(k.nopol), k]));
    const timpa = new Map<number, number>();
    const baris = data.map(({ v, galat }) => {
      const b: BarisPratinjau = { baris: v.baris, tampil: [v.nopol, v.pemilik, v.npwp ?? ''], galat };
      const lama = peta.get(v.nopol);
      if (lama && !galat.length) {
        timpa.set(v.baris, lama.id);
        b.duplikat = { keterangan: `Sudah terdaftar milik ${lama.nama_pemilik ?? '—'}.`, bisaTimpa: true };
      }
      return b;
    });
    gandaDalamBerkas(baris, data.map((d) => d.v.nopol || null), 'Nomor polisi');
    return { kolom: ['Nopol', 'Pemilik', 'NPWP'], baris, payload: (pilihan) => ({ p_entity_id: entity.id, p_rows: pilihBaris(data.map((d) => d.v), timpa, pilihan) }) };
  }
};

// ---------------------------------------------------------------------------

const kapal: DefImpor = {
  label: 'Kapal',
  rpc: 'impor_kapal',
  kolom: [
    { judul: 'Nama Kapal / VOY', kunci: 'nama_kapal', tipe: 'teks', wajib: true, contoh: 'KM Sinar Jaya', lebar: 28 },
    { judul: 'Perusahaan Pemilik Kapal', kunci: 'pemilik_kapal', tipe: 'teks', contoh: 'PT Pelayaran Nusantara', lebar: 30 }
  ],
  petunjuk: ['Satu baris = satu kapal.', 'Nama kapal dibandingkan tanpa memedulikan huruf besar-kecil dan spasi.'],
  async ekspor({ db, entity }) {
    const { data } = await db.from('kapal').select('nama_kapal, pemilik_kapal').eq('entity_id', entity.id).order('nama_kapal').returns<{ nama_kapal: string; pemilik_kapal: string | null }[]>();
    return data ?? [];
  },
  async periksa(rows, { db, entity }) {
    const data = rows.map((row) => {
      const galat: string[] = [];
      return {
        v: { baris: row.baris, nama_kapal: wajibTeks(row, 'nama_kapal', 'Nama kapal', galat), pemilik_kapal: opsiTeks(row, 'pemilik_kapal', 'Perusahaan pemilik kapal', galat) },
        galat
      };
    });
    const { data: ada } = await db.from('kapal').select('id, nama_kapal, pemilik_kapal').eq('entity_id', entity.id).returns<{ id: number; nama_kapal: string; pemilik_kapal: string | null }[]>();
    const peta = new Map((ada ?? []).map((k) => [banding(k.nama_kapal), k]));
    const timpa = new Map<number, number>();
    const baris = data.map(({ v, galat }) => {
      const b: BarisPratinjau = { baris: v.baris, tampil: [v.nama_kapal, v.pemilik_kapal ?? ''], galat };
      const lama = peta.get(banding(v.nama_kapal));
      if (lama && !galat.length) {
        timpa.set(v.baris, lama.id);
        b.duplikat = { keterangan: `Sudah terdaftar${lama.pemilik_kapal ? ` (pemilik ${lama.pemilik_kapal})` : ''}.`, bisaTimpa: true };
      }
      return b;
    });
    gandaDalamBerkas(baris, data.map((d) => banding(d.v.nama_kapal) || null), 'Nama kapal');
    return { kolom: ['Nama Kapal', 'Perusahaan Pemilik'], baris, payload: (pilihan) => ({ p_entity_id: entity.id, p_rows: pilihBaris(data.map((d) => d.v), timpa, pilihan) }) };
  }
};

// ---------------------------------------------------------------------------

const karyawan: DefImpor = {
  label: 'Karyawan',
  rpc: 'impor_karyawan',
  kolom: [
    { judul: 'Nama Lengkap', kunci: 'nama', tipe: 'teks', wajib: true, contoh: 'Budi Santoso', lebar: 24 },
    { judul: 'Jabatan', kunci: 'jabatan', tipe: 'teks', contoh: 'Telly', lebar: 16, catatan: 'Isi "Telly" untuk petugas telly, "Admin" untuk gaji admin.' },
    { judul: 'No. HP / WhatsApp', kunci: 'no_hp', tipe: 'teks', contoh: '0812xxxxxxx', lebar: 16 },
    { judul: 'Tanggal Bergabung', kunci: 'tanggal_bergabung', tipe: 'tanggal', contoh: '01/01/2026' },
    { judul: 'No. KTP', kunci: 'ktp', tipe: 'teks', lebar: 20 },
    { judul: 'No. NPWP', kunci: 'npwp', tipe: 'teks', lebar: 22 },
    { judul: 'Alamat', kunci: 'alamat', tipe: 'teks', lebar: 32 },
    { judul: 'Status', kunci: 'status', tipe: 'teks', contoh: 'aktif', lebar: 10, daftar: { kunci: 'status', ketat: true }, catatan: 'aktif atau nonaktif; kosong = aktif.' }
  ],
  petunjuk: ['Satu baris = satu karyawan.', 'Nama yang sudah terdaftar ditandai sebagai duplikat.'],
  daftar: async () => ({ status: ['aktif', 'nonaktif'] }),
  async ekspor({ db, entity }) {
    const { data } = await db
      .from('karyawan')
      .select('nama, jabatan, no_hp, tanggal_bergabung, ktp, npwp, alamat, status')
      .eq('entity_id', entity.id)
      .order('status')
      .order('nama')
      .returns<BarisEkspor[]>();
    return data ?? [];
  },
  async periksa(rows, { db, entity }) {
    const data = rows.map((row) => {
      const galat: string[] = [];
      const status = teks(row.nilai.status).toLowerCase();
      if (status && status !== 'aktif' && status !== 'nonaktif') galat.push('Status harus aktif atau nonaktif.');
      const v = {
        baris: row.baris,
        nama: wajibTeks(row, 'nama', 'Nama karyawan', galat),
        jabatan: opsiTeks(row, 'jabatan', 'Jabatan', galat),
        no_hp: opsiTeks(row, 'no_hp', 'No. HP', galat, 30),
        tanggal_bergabung: bacaTanggal(row, 'tanggal_bergabung', 'Tanggal bergabung', galat),
        ktp: opsiTeks(row, 'ktp', 'No. KTP', galat),
        npwp: opsiTeks(row, 'npwp', 'No. NPWP', galat),
        alamat: opsiTeks(row, 'alamat', 'Alamat', galat, 2000),
        status: status || 'aktif'
      };
      return { v, galat };
    });
    const { data: ada } = await db.from('karyawan').select('id, nama, jabatan').eq('entity_id', entity.id).returns<{ id: number; nama: string; jabatan: string | null }[]>();
    const peta = new Map((ada ?? []).map((k) => [banding(k.nama), k]));
    const timpa = new Map<number, number>();
    const baris = data.map(({ v, galat }) => {
      const b: BarisPratinjau = { baris: v.baris, tampil: [v.nama, v.jabatan ?? '', v.no_hp ?? '', tgl(v.tanggal_bergabung), v.status], galat };
      const lama = peta.get(banding(v.nama));
      if (lama && !galat.length) {
        timpa.set(v.baris, lama.id);
        b.duplikat = { keterangan: `Sudah terdaftar${lama.jabatan ? ` sebagai ${lama.jabatan}` : ''}.`, bisaTimpa: true };
      }
      return b;
    });
    gandaDalamBerkas(baris, data.map((d) => banding(d.v.nama) || null), 'Nama karyawan');
    return { kolom: ['Nama', 'Jabatan', 'No. HP', 'Bergabung', 'Status'], baris, payload: (pilihan) => ({ p_entity_id: entity.id, p_rows: pilihBaris(data.map((d) => d.v), timpa, pilihan) }) };
  }
};

// ---------------------------------------------------------------------------

const TARIF_TEKS = TARIF_PAJAK.map((t) => String(t).replace('.', ','));

const pendapatan: DefImpor = {
  label: 'Pendapatan (baris manual)',
  rpc: 'impor_pendapatan',
  perBulan: true,
  kolom: [
    { judul: 'Kegiatan (Kapal)', kunci: 'kegiatan', tipe: 'teks', wajib: true, contoh: 'KM Sinar Jaya', lebar: 26 },
    { judul: 'No. Invoice', kunci: 'no_invoice', tipe: 'teks', lebar: 20, catatan: 'Kosong = nomor otomatis.' },
    { judul: 'No. Faktur Pajak', kunci: 'no_faktur_pajak', tipe: 'teks', lebar: 20 },
    { judul: 'No. STO/SPO', kunci: 'no_sto_spo', tipe: 'teks', lebar: 16 },
    { judul: 'Lokasi (Rute)', kunci: 'lokasi', tipe: 'teks', contoh: 'Gudang Veteran - Pelabuhan', lebar: 26 },
    { judul: 'Tanggal Kegiatan (teks)', kunci: 'tanggal_kegiatan', tipe: 'teks', contoh: '05 s/d 07 Desember 2026', lebar: 24 },
    { judul: 'Party (KG)', kunci: 'party_kg', tipe: 'rupiah', wajib: true, contoh: 10000, lebar: 12 },
    { judul: 'Harga /Ton (Rp)', kunci: 'harga', tipe: 'rupiah', contoh: 34500, catatan: 'Kosong = 34.500.' },
    { judul: 'Tarif Pajak (%)', kunci: 'tarif_pajak', tipe: 'teks', contoh: '0,5', daftar: { kunci: 'tarif', ketat: true }, catatan: '0,5 / 2 / 0; kosong = 0,5.' },
    { judul: 'Status Entry', kunci: 'status_entry', tipe: 'teks', lebar: 18, daftar: { kunci: 'status', ketat: true } },
    { judul: 'Tanggal Entry', kunci: 'tanggal_entry', tipe: 'tanggal' },
    { judul: 'Payment Date', kunci: 'payment_date', tipe: 'tanggal' },
    { judul: 'Keterangan', kunci: 'keterangan', tipe: 'teks', lebar: 28 }
  ],
  petunjuk: [
    'Untuk invoice yang TIDAK berasal dari kegiatan kapal. Invoice kegiatan kapal dibuat dengan "Generate dari Kegiatan".',
    'Semua baris masuk ke bulan yang sedang dibuka di layar Pendapatan.',
    'No. invoice yang sudah ada ditandai sebagai duplikat; invoice yang sudah dibayar tidak bisa ditimpa.'
  ],
  daftar: async () => ({ tarif: TARIF_TEKS, status: [...STATUS_ENTRY] }),
  eksporBulanan: true,
  async ekspor({ db, entity, periode }) {
    const { data } = await db
      .from('laporan_pendapatan')
      .select('kegiatan, no_invoice, no_faktur_pajak, no_sto_spo, lokasi, tanggal_kegiatan, party_kg, harga, tarif_pajak, status_entry, tanggal_entry, payment_date, keterangan')
      .eq('entity_id', entity.id)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .order('no_urut', { ascending: true, nullsFirst: false })
      .order('id')
      .returns<BarisEkspor[]>();
    return (data ?? []).map((r) => ({
      ...r,
      party_kg: angka(r.party_kg),
      harga: angka(r.harga),
      tarif_pajak: r.tarif_pajak === null ? null : String(Number(r.tarif_pajak)).replace('.', ',')
    }));
  },
  async periksa(rows, { db, entity, periode }) {
    const data = rows.map((row) => {
      const galat: string[] = [];
      const tarifTeks = teks(row.nilai.tarif_pajak).replace(',', '.').replace('%', '');
      const tarif = tarifTeks === '' ? 0.5 : Number(tarifTeks);
      if (!TARIF_PAJAK.includes(tarif as never)) galat.push('Tarif pajak harus 0,5 / 2 / 0.');
      const status = teks(row.nilai.status_entry).toUpperCase();
      if (status && !STATUS_ENTRY.includes(status as never)) galat.push(`Status entry harus salah satu dari: ${STATUS_ENTRY.join(', ')}.`);
      const party = bacaRupiahKol(row, 'party_kg', 'Party (KG)', galat, true);
      const v = {
        baris: row.baris,
        kegiatan: wajibTeks(row, 'kegiatan', 'Kegiatan', galat),
        no_invoice: opsiTeks(row, 'no_invoice', 'No. invoice', galat),
        no_faktur_pajak: opsiTeks(row, 'no_faktur_pajak', 'No. faktur pajak', galat),
        no_sto_spo: opsiTeks(row, 'no_sto_spo', 'No. STO/SPO', galat),
        lokasi: opsiTeks(row, 'lokasi', 'Lokasi', galat),
        tanggal_kegiatan: opsiTeks(row, 'tanggal_kegiatan', 'Tanggal kegiatan', galat),
        party_kg: party,
        harga: bacaRupiahKol(row, 'harga', 'Harga per ton', galat) ?? 34500,
        tarif_pajak: tarif,
        status_entry: status || null,
        tanggal_entry: bacaTanggal(row, 'tanggal_entry', 'Tanggal entry', galat),
        payment_date: bacaTanggal(row, 'payment_date', 'Payment date', galat),
        keterangan: opsiTeks(row, 'keterangan', 'Keterangan', galat, 2000)
      };
      return { v, galat };
    });
    const nomor = data.map((d) => d.v.no_invoice).filter((n): n is string => !!n);
    const { data: ada } = nomor.length
      ? await db
          .from('laporan_pendapatan')
          .select('id, no_invoice, bulan, tahun, status_entry, payment_date')
          .eq('entity_id', entity.id)
          .in('no_invoice', nomor)
          .returns<{ id: number; no_invoice: string; bulan: number; tahun: number; status_entry: string | null; payment_date: string | null }[]>()
      : { data: [] };
    const peta = new Map((ada ?? []).map((p) => [p.no_invoice, p]));
    const timpa = new Map<number, number>();
    const baris = data.map(({ v, galat }) => {
      const total = v.party_kg === null ? null : Math.round((v.party_kg * v.harga) / 1000);
      const b: BarisPratinjau = { baris: v.baris, tampil: [v.kegiatan, v.no_invoice ?? '(otomatis)', String(v.party_kg ?? ''), total === null ? '' : rp(total), `${String(v.tarif_pajak).replace('.', ',')}%`], galat };
      const lama = v.no_invoice ? peta.get(v.no_invoice) : undefined;
      if (lama && !galat.length) {
        const dibayar = lama.status_entry === 'LUNAS' || !!lama.payment_date;
        if (!dibayar) timpa.set(v.baris, lama.id);
        b.duplikat = {
          keterangan: dibayar
            ? `Invoice ini sudah ada (${NAMA_BULAN[lama.bulan - 1]} ${lama.tahun}) dan sudah dibayar — akan dilewati.`
            : `Invoice ini sudah ada (${NAMA_BULAN[lama.bulan - 1]} ${lama.tahun}).`,
          bisaTimpa: !dibayar
        };
      }
      return b;
    });
    gandaDalamBerkas(baris, data.map((d) => d.v.no_invoice), 'No. invoice');
    const dilewati = new Set(baris.filter((b) => b.duplikat && !b.duplikat.bisaTimpa).map((b) => b.baris));
    return {
      kolom: ['Kegiatan', 'No. Invoice', 'Party (KG)', 'Total', 'Pajak'],
      baris,
      payload: (pilihan) => ({
        p_entity_id: entity.id,
        p_bulan: periode.bulan,
        p_tahun: periode.tahun,
        p_rows: pilihBaris(data.map((d) => d.v).filter((v) => !dilewati.has(v.baris)), timpa, pilihan)
      })
    };
  }
};

// ---------------------------------------------------------------------------

/**
 * Kegiatan & truk: one row per truck. Rows with the same ship and start date
 * are one kegiatan; its own fields (route, operational cost, telly, notes)
 * may be filled on its first row only, or repeated identically.
 */
const kegiatan: DefImpor = {
  label: 'Kegiatan Kapal & Truk',
  rpc: 'impor_kegiatan',
  kolom: [
    { judul: 'Tanggal Kegiatan (mulai)', kunci: 'tanggal_kegiatan', tipe: 'tanggal', wajib: true, contoh: '05/12/2026' },
    { judul: 'Tanggal Selesai', kunci: 'tanggal_selesai', tipe: 'tanggal', contoh: '07/12/2026' },
    { judul: 'Nama Kapal / VOY', kunci: 'nama_kapal', tipe: 'teks', wajib: true, contoh: 'KM Sinar Jaya', lebar: 24, daftar: { kunci: 'kapal' }, catatan: 'Kapal baru otomatis ditambahkan.' },
    { judul: 'Rute Asal', kunci: 'rute_asal', tipe: 'teks', contoh: 'Gudang Veteran', lebar: 18, daftar: { kunci: 'asal' } },
    { judul: 'Rute Tujuan', kunci: 'rute_tujuan', tipe: 'teks', contoh: 'Pelabuhan', lebar: 18 },
    { judul: 'Biaya Operasional (Rp)', kunci: 'operasional', tipe: 'rupiah', contoh: 300000, catatan: 'Per kegiatan — cukup di baris truk pertama.' },
    { judul: 'Petugas Telly', kunci: 'telly', tipe: 'teks', lebar: 20, daftar: { kunci: 'telly', ketat: true }, catatan: 'Nama karyawan aktif.' },
    { judul: 'Keterangan', kunci: 'keterangan', tipe: 'teks', lebar: 22 },
    { judul: 'Nomor Polisi Truk', kunci: 'nopol', tipe: 'teks', wajib: true, contoh: 'W 1234 AB', lebar: 16, daftar: { kunci: 'nopol' } },
    { judul: 'Pemilik Truk', kunci: 'pemilik', tipe: 'teks', lebar: 20, daftar: { kunci: 'pemilik' }, catatan: 'Wajib untuk truk yang belum terdaftar.' },
    { judul: 'Ritase', kunci: 'ritase', tipe: 'bulat', contoh: 2 },
    { judul: 'Tonase (MT)', kunci: 'tonase', tipe: 'desimal', contoh: 10 },
    { judul: 'Ongkos Angkut /Ton (Rp)', kunci: 'ongkos_angkut', tipe: 'rupiah', contoh: 20000 },
    { judul: 'Saku Supir (Rp)', kunci: 'sangu_supir', tipe: 'rupiah', contoh: 150000 },
    { judul: 'Terpal (Rp)', kunci: 'terpal', tipe: 'rupiah', contoh: 50000 }
  ],
  petunjuk: [
    'Satu baris = satu truk. Baris dengan nama kapal dan tanggal mulai yang sama menjadi satu kegiatan.',
    'Rute, biaya operasional, telly, dan keterangan cukup diisi di baris truk pertama kegiatan itu.',
    'Bulan pengiriman mengikuti tanggal kegiatan (mulai), bukan bulan yang sedang dibuka di layar.',
    'Kegiatan dengan kapal dan tanggal mulai yang sudah ada ditandai sebagai duplikat. Bila "data baru" dipilih, daftar truknya DIGANTI dengan isi file.'
  ],
  daftar: async ({ db, entity }) => {
    const [kp, kd, pm, ky] = await Promise.all([
      db.from('kapal').select('nama_kapal').eq('entity_id', entity.id).order('nama_kapal').returns<{ nama_kapal: string }[]>(),
      db.from('kendaraan').select('nopol').eq('entity_id', entity.id).order('nopol').returns<{ nopol: string }[]>(),
      db.from('pemilik').select('nama_pemilik').eq('entity_id', entity.id).order('nama_pemilik').returns<{ nama_pemilik: string }[]>(),
      db.from('karyawan').select('nama').eq('entity_id', entity.id).eq('status', 'aktif').order('nama').returns<{ nama: string }[]>()
    ]);
    return {
      kapal: (kp.data ?? []).map((r) => r.nama_kapal),
      nopol: (kd.data ?? []).map((r) => r.nopol),
      pemilik: (pm.data ?? []).map((r) => r.nama_pemilik),
      telly: (ky.data ?? []).map((r) => r.nama),
      asal: ['Gudang Veteran', 'KIG', 'Manyar', 'Pabrik Wilmar']
    };
  },
  eksporBulanan: true,
  async ekspor({ db, entity, periode }) {
    type Rekap = { id: number; kapal_id: number; rute: string | null; operasional: string | null; telly_id: number | null; tanggal_kegiatan: string | null; tanggal_selesai: string | null; keterangan: string | null };
    type Truk = { operasional_rekap_id: number; kendaraan_id: number | null; ritase: number | null; tonase: string | null; ongkos_angkut: string | null; sangu_supir: string | null; terpal: string | null };
    const { data: rekap } = await db
      .from('operasional_rekap')
      .select('id, kapal_id, rute, operasional, telly_id, tanggal_kegiatan, tanggal_selesai, keterangan')
      .eq('entity_id', entity.id)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .order('tanggal_kegiatan', { nullsFirst: false })
      .order('id')
      .returns<Rekap[]>();
    if (!rekap?.length) return [];
    const [kp, ky, kd, tr] = await Promise.all([
      db.from('kapal').select('id, nama_kapal').eq('entity_id', entity.id).returns<{ id: number; nama_kapal: string }[]>(),
      db.from('karyawan').select('id, nama').eq('entity_id', entity.id).returns<{ id: number; nama: string }[]>(),
      db.from('v_kendaraan_ringkasan').select('id, nopol, nama_pemilik').eq('entity_id', entity.id).returns<{ id: number; nopol: string; nama_pemilik: string | null }[]>(),
      db
        .from('transaksi_operasional')
        .select('operasional_rekap_id, kendaraan_id, ritase, tonase, ongkos_angkut, sangu_supir, terpal')
        .in('operasional_rekap_id', rekap.map((r) => r.id))
        .order('id')
        .returns<Truk[]>()
    ]);
    const kapal = new Map((kp.data ?? []).map((k) => [k.id, k.nama_kapal]));
    const telly = new Map((ky.data ?? []).map((k) => [k.id, k.nama]));
    const kendaraan = new Map((kd.data ?? []).map((k) => [k.id, k]));
    const trukPer = new Map<number, Truk[]>();
    for (const t of tr.data ?? []) trukPer.set(t.operasional_rekap_id, [...(trukPer.get(t.operasional_rekap_id) ?? []), t]);

    // One row per truck, the kegiatan's own fields on its first row only (as
    // the template asks). A kegiatan without trucks still gets a row.
    return rekap.flatMap((r) => {
      const { asal, tujuan } = pecahRute(r.rute);
      const kegiatan: BarisEkspor = {
        tanggal_kegiatan: r.tanggal_kegiatan,
        tanggal_selesai: r.tanggal_selesai,
        nama_kapal: kapal.get(r.kapal_id) ?? null,
        rute_asal: asal || null,
        rute_tujuan: tujuan || null,
        operasional: angka(r.operasional),
        telly: r.telly_id ? (telly.get(r.telly_id) ?? null) : null,
        keterangan: r.keterangan
      };
      const truk = trukPer.get(r.id) ?? [];
      if (!truk.length) return [kegiatan];
      return truk.map((t, i) => ({
        ...(i === 0 ? kegiatan : { tanggal_kegiatan: r.tanggal_kegiatan, tanggal_selesai: r.tanggal_selesai, nama_kapal: kegiatan.nama_kapal }),
        nopol: (t.kendaraan_id && kendaraan.get(t.kendaraan_id)?.nopol) || null,
        pemilik: (t.kendaraan_id && kendaraan.get(t.kendaraan_id)?.nama_pemilik) || null,
        ritase: t.ritase,
        tonase: angka(t.tonase),
        ongkos_angkut: angka(t.ongkos_angkut),
        sangu_supir: angka(t.sangu_supir),
        terpal: angka(t.terpal)
      }));
    });
  },
  async periksa(rows, { db, entity, periode }) {
    const [kd, ky, kp] = await Promise.all([
      db.from('kendaraan').select('nopol').eq('entity_id', entity.id).returns<{ nopol: string }[]>(),
      db.from('karyawan').select('id, nama').eq('entity_id', entity.id).eq('status', 'aktif').returns<{ id: number; nama: string }[]>(),
      db.from('kapal').select('id, nama_kapal').eq('entity_id', entity.id).returns<{ id: number; nama_kapal: string }[]>()
    ]);
    const terdaftar = new Set((kd.data ?? []).map((k) => normalNopol(k.nopol)));
    const telly = new Map((ky.data ?? []).map((k) => [banding(k.nama), k.id]));

    type Truk = { baris: number; nopol: string; pemilik_baru: string; ritase: number; tonase: number; ongkos_angkut: number; sangu_supir: number; terpal: number };
    type Keg = {
      baris: number;
      nama_kapal: string;
      tanggal_kegiatan: string;
      tanggal_selesai: string | null;
      rute: string | null;
      operasional: number;
      telly_id: number | null;
      keterangan: string | null;
      truk: Truk[];
      galat: string[];
    };
    const grup = new Map<string, Keg>();
    const baris: BarisPratinjau[] = [];

    for (const row of rows) {
      const galat: string[] = [];
      const tglMulai = bacaTanggal(row, 'tanggal_kegiatan', 'Tanggal kegiatan', galat, true);
      const tglSelesai = bacaTanggal(row, 'tanggal_selesai', 'Tanggal selesai', galat);
      if (tglMulai && tglSelesai && tglSelesai < tglMulai) galat.push('Tanggal selesai tidak boleh sebelum tanggal kegiatan.');
      const namaKapal = wajibTeks(row, 'nama_kapal', 'Nama kapal', galat);
      const nopol = normalNopol(wajibTeks(row, 'nopol', 'Nomor polisi truk', galat));
      const pemilikBaru = teks(row.nilai.pemilik);
      if (nopol && !terdaftar.has(nopol) && !pemilikBaru) galat.push(`Truk ${nopol} belum terdaftar: isi kolom Pemilik Truk.`);
      const ritase = bulat(row.nilai.ritase);
      if (ritase === undefined) galat.push('Ritase harus bilangan bulat 0 atau lebih.');
      const tonase = desimal(row.nilai.tonase);
      if (tonase === undefined) galat.push('Tonase harus angka 0 atau lebih, mis. 12,5.');
      const ongkos = bacaRupiahKol(row, 'ongkos_angkut', 'Ongkos angkut', galat);
      const saku = bacaRupiahKol(row, 'sangu_supir', 'Saku supir', galat);
      const terpal = bacaRupiahKol(row, 'terpal', 'Terpal', galat);
      const operasional = bacaRupiahKol(row, 'operasional', 'Biaya operasional', galat);
      const asal = teks(row.nilai.rute_asal);
      const tujuan = teks(row.nilai.rute_tujuan);
      const tellyNama = teks(row.nilai.telly);
      const tellyId = tellyNama ? (telly.get(banding(tellyNama)) ?? null) : null;
      if (tellyNama && tellyId === null) galat.push(`Petugas telly "${tellyNama}" tidak ditemukan di karyawan aktif.`);
      const keterangan = opsiTeks(row, 'keterangan', 'Keterangan', galat, 2000);

      const kunci = tglMulai && namaKapal ? `${banding(namaKapal)}|${tglMulai}` : `baris-${row.baris}`;
      let g = grup.get(kunci);
      const b: BarisPratinjau = {
        baris: row.baris,
        tampil: [tgl(tglMulai), tglMulai ? namaBulan(tglMulai) : '', namaKapal, nopol, pemilikBaru || (terdaftar.has(nopol) ? '(terdaftar)' : ''), String(ritase ?? ''), String(tonase ?? '')],
        galat
      };
      if (!g) {
        const peringatan = [bulanLain(tglMulai, periode)].filter((p): p is string => !!p);
        const hari = tglMulai && tglSelesai ? (Date.parse(tglSelesai) - Date.parse(tglMulai)) / 86_400_000 : 0;
        if (hari > 31) peringatan.push(`Kegiatan berlangsung ${hari} hari (${tgl(tglMulai)} s/d ${tgl(tglSelesai)}). Pastikan tanggal ditulis dd/mm/yyyy.`);
        if (peringatan.length) b.peringatan = peringatan;
        g = {
          baris: row.baris,
          nama_kapal: namaKapal,
          tanggal_kegiatan: tglMulai ?? '',
          tanggal_selesai: tglSelesai,
          rute: asal || tujuan ? susunRute(asal, tujuan) : null,
          operasional: operasional ?? 0,
          telly_id: tellyId,
          keterangan,
          truk: [],
          galat
        };
        grup.set(kunci, g);
      } else {
        b.ikutBaris = g.baris;
        // A kegiatan's own fields: blank on later rows, or the same value.
        const beda = (label: string, a: unknown, x: unknown) => {
          if (x !== null && x !== undefined && x !== '' && x !== 0 && a !== x) galat.push(`${label} berbeda dengan baris ${g!.baris} untuk kegiatan yang sama.`);
        };
        beda('Biaya operasional', g.operasional, operasional);
        beda('Petugas telly', g.telly_id, tellyId);
        beda('Rute', g.rute, asal || tujuan ? susunRute(asal, tujuan) : null);
        beda('Tanggal selesai', g.tanggal_selesai, tglSelesai);
        if (g.truk.some((t) => t.nopol === nopol)) galat.push(`Truk ${nopol} tercantum dua kali pada kegiatan ini.`);
      }
      g.truk.push({ baris: row.baris, nopol, pemilik_baru: pemilikBaru, ritase: ritase ?? 0, tonase: tonase ?? 0, ongkos_angkut: ongkos ?? 0, sangu_supir: saku ?? 0, terpal: terpal ?? 0 });
      baris.push(b);
    }

    // Duplicates: a kegiatan with the same ship and start date already exists.
    const kapalId = new Map((kp.data ?? []).map((k) => [banding(k.nama_kapal), k.id]));
    const tanggalAda = [...grup.values()].map((g) => g.tanggal_kegiatan).filter(Boolean);
    const { data: ada } = tanggalAda.length
      ? await db
          .from('operasional_rekap')
          .select('id, kapal_id, tanggal_kegiatan')
          .eq('entity_id', entity.id)
          .in('tanggal_kegiatan', tanggalAda)
          .returns<{ id: number; kapal_id: number; tanggal_kegiatan: string }[]>()
      : { data: [] };
    const timpa = new Map<number, number>();
    for (const g of grup.values()) {
      const id = kapalId.get(banding(g.nama_kapal));
      const lama = (ada ?? []).find((r) => r.kapal_id === id && r.tanggal_kegiatan === g.tanggal_kegiatan);
      const pertama = baris.find((b) => b.baris === g.baris)!;
      if (lama && !pertama.galat.length) {
        timpa.set(g.baris, lama.id);
        pertama.duplikat = { keterangan: 'Kegiatan kapal ini pada tanggal itu sudah ada. "Data baru" mengganti daftar truknya dengan isi file.', bisaTimpa: true };
      }
    }

    return {
      kolom: ['Tanggal', 'Bulan', 'Kapal', 'Nopol', 'Pemilik', 'Ritase', 'Tonase'],
      baris,
      payload: (pilihan) => ({
        p_entity_id: entity.id,
        p_kegiatan: [...grup.values()]
          .filter((g) => !(timpa.has(g.baris) && pilihan[g.baris] !== 'baru'))
          .map(({ galat: _g, truk, ...g }) => ({
            ...g,
            bulan: Number(g.tanggal_kegiatan.slice(5, 7)),
            tahun: Number(g.tanggal_kegiatan.slice(0, 4)),
            tanggal_input: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }),
            timpa_id: timpa.get(g.baris) ?? null,
            truk: truk.map(({ baris: _b, pemilik_baru, ...t }) => ({ ...t, pemilik_baru }))
          }))
      })
    };
  }
};

export const IMPOR: Record<JenisImpor, DefImpor> = { pengeluaran, kegiatan, pendapatan, pemilik, kendaraan, kapal, karyawan };
