/**
 * The import template as a file, and reading a filled-in one back.
 *
 *   Data       the sheet the admin fills: one header row, required columns
 *              marked "*", dropdowns where the value comes from a list.
 *              "Ekspor" is this same file with the screen's data already in
 *              it, so it can be edited and uploaded back.
 *   Petunjuk   what each column means, its format and an example — kept off
 *              the Data sheet so an example row can never be imported.
 *   Daftar     (hidden) the dropdown lists.
 *   _meta      (very hidden) which template this is, so a Kapal file
 *              uploaded on the Pengeluaran screen is refused by name.
 */
import ExcelJS from 'exceljs';
import type { JenisImpor } from '$lib/impor';
import { NAMA_BULAN } from '$lib/operasional/kegiatan';
import type { BarisEkspor, BarisMentah, DefImpor, Konteks } from './jenis';
import { mentah, teks } from './sel';

const DATA = 'Data';
const META = '_meta';
const BARIS_DISIAPKAN = 1000;
const MAKS_BARIS = 2000;

const FORMAT: Record<string, string | undefined> = {
  // Text, not a date format: Excel parses a typed date by the computer's
  // locale, so on a US-locale laptop "5/10/2026" became 10 May. As text it
  // reaches the server as typed and is read dd/mm/yyyy (sel.ts tanggal()).
  tanggal: '@',
  rupiah: '#,##0',
  desimal: '#,##0.##',
  bulat: '0'
};

const judulKolom = (k: { judul: string; wajib?: boolean }) => (k.wajib ? `${k.judul} *` : k.judul);

export async function buatTemplate(jenis: JenisImpor, def: DefImpor, k: Konteks, isi: BarisEkspor[] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IMR Platform';
  const daftar = def.daftar ? await def.daftar(k) : {};

  // --- Data ---------------------------------------------------------------
  const ws = wb.addWorksheet(DATA, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = def.kolom.map((c) => ({ width: c.lebar ?? (c.tipe === 'tanggal' ? 14 : c.tipe === 'teks' ? 20 : 14) }));
  const head = ws.getRow(1);
  head.values = def.kolom.map(judulKolom);
  head.font = { bold: true };
  head.height = 30;
  head.eachCell((cell, i) => {
    const wajib = def.kolom[i - 1].wajib;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: wajib ? 'FFDBEAFE' : 'FFE5E7EB' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    const c = def.kolom[i - 1];
    cell.note = [c.wajib ? 'Wajib diisi.' : 'Boleh kosong.', c.catatan ?? '', c.contoh !== undefined ? `Contoh: ${c.contoh}` : '']
      .filter(Boolean)
      .join('\n');
  });

  isi.forEach((baris, j) => {
    def.kolom.forEach((c, i) => {
      const v = baris[c.kunci];
      if (v === null || v === undefined || v === '') return;
      // Dates as dd/mm/yyyy text, like a typed one (see FORMAT.tanggal).
      ws.getCell(j + 2, i + 1).value = c.tipe === 'tanggal' && typeof v === 'string' ? v.split('-').reverse().join('/') : v;
    });
  });
  const disiapkan = Math.max(BARIS_DISIAPKAN, isi.length + 500);

  // --- Daftar (hidden lists) + dropdowns ------------------------------------
  const wd = wb.addWorksheet('Daftar', { state: 'hidden' });
  let kolDaftar = 0;
  def.kolom.forEach((c, i) => {
    const fmt = FORMAT[c.tipe];
    const col = ws.getColumn(i + 1);
    if (fmt) for (let r = 2; r <= disiapkan; r++) ws.getCell(r, i + 1).numFmt = fmt;
    if (c.tipe === 'teks' || c.tipe === 'tanggal') col.alignment = { vertical: 'top' };

    const isi = c.daftar ? (daftar[c.daftar.kunci] ?? []) : [];
    if (!c.daftar || isi.length === 0) return;
    kolDaftar += 1;
    const huruf = wd.getColumn(kolDaftar).letter;
    wd.getCell(1, kolDaftar).value = c.judul;
    isi.forEach((v, j) => (wd.getCell(j + 2, kolDaftar).value = v));
    const rumus = `Daftar!$${huruf}$2:$${huruf}$${isi.length + 1}`;
    for (let r = 2; r <= disiapkan; r++) {
      ws.getCell(r, i + 1).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [rumus],
        showErrorMessage: true,
        // Strict lists (status, tarif) refuse other values; the rest only suggest.
        errorStyle: c.daftar.ketat ? 'stop' : 'information',
        errorTitle: c.judul,
        error: c.daftar.ketat ? 'Pilih salah satu nilai dari daftar.' : 'Nilai ini tidak ada di daftar — akan ditambahkan sebagai data baru.'
      };
    }
  });

  // --- Petunjuk -------------------------------------------------------------
  const wp = wb.addWorksheet('Petunjuk');
  wp.columns = [{ width: 28 }, { width: 12 }, { width: 16 }, { width: 22 }, { width: 50 }];
  const ekspor = isi.length > 0;
  const bulan = def.perBulan || (ekspor && def.eksporBulanan);
  wp.addRow([`${ekspor ? 'Ekspor Data' : 'Template Impor'} — ${def.label}`]).font = { bold: true, size: 13 };
  wp.addRow([
    `${k.entity.legal_name}${bulan ? ` · ${NAMA_BULAN[k.periode.bulan - 1]} ${k.periode.tahun}` : ''}`
  ]).font = { color: { argb: 'FF4B5563' } };
  if (ekspor) {
    wp.addRow([
      `Sheet "Data" berisi ${isi.length} baris dari sistem. File ini bisa diubah lalu diunggah kembali: baris yang sudah ada ditandai sebagai duplikat, dan Anda memilih data lama atau data baru.`
    ]);
  }
  wp.addRow([]);
  wp.addRow(['Cara mengisi']).font = { bold: true };
  for (const p of [
    'Isi sheet "Data" mulai baris 2. Jangan ubah atau pindahkan judul kolom di baris 1.',
    'Kolom bertanda * wajib diisi. Arahkan kursor ke judul kolom untuk melihat penjelasannya.',
    'Tanggal ditulis dd/mm/yyyy, mis. 05/12/2026. Rupiah ditulis tanpa "Rp", mis. 1250000 atau 1.250.000.',
    ...def.petunjuk,
    'Unggah file ini di layar yang sama. Sistem menampilkan pratinjau dan memeriksa setiap baris; data baru disimpan setelah semua baris benar.'
  ]) {
    wp.addRow([`• ${p}`]);
  }
  wp.addRow([]);
  const h = wp.addRow(['Kolom', 'Wajib', 'Format', 'Contoh', 'Keterangan']);
  h.font = { bold: true };
  h.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }));
  const FORMAT_TEKS: Record<string, string> = { teks: 'teks', tanggal: 'dd/mm/yyyy', rupiah: 'angka rupiah', desimal: 'angka (koma desimal)', bulat: 'bilangan bulat' };
  for (const c of def.kolom) {
    wp.addRow([c.judul, c.wajib ? 'Ya' : '', FORMAT_TEKS[c.tipe], c.contoh ?? '', [c.catatan, c.daftar ? 'Ada daftar pilihan (dropdown).' : ''].filter(Boolean).join(' ')]);
  }

  // --- _meta ----------------------------------------------------------------
  const wm = wb.addWorksheet(META, { state: 'veryHidden' });
  wm.getCell('A1').value = 'jenis';
  wm.getCell('B1').value = jenis;
  wm.getCell('A2').value = 'entitas';
  wm.getCell('B2').value = k.entity.code;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface HasilBaca {
  rows: BarisMentah[];
  galatBerkas: string[];
}

export async function bacaBerkas(jenis: JenisImpor, def: DefImpor, isi: ArrayBuffer): Promise<HasilBaca> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(isi);
  } catch {
    return { rows: [], galatBerkas: ['File tidak bisa dibaca. Pastikan formatnya .xlsx (Excel), bukan .xls atau .csv.'] };
  }

  const meta = wb.getWorksheet(META);
  const jenisFile = meta ? teks(mentah(meta.getCell('B1').value)) : '';
  if (jenisFile && jenisFile !== jenis) {
    return { rows: [], galatBerkas: [`File ini template "${jenisFile}", bukan template ${def.label}. Unduh template dari layar ini.`] };
  }

  const ws = wb.getWorksheet(DATA) ?? wb.worksheets[0];
  if (!ws) return { rows: [], galatBerkas: ['File tidak berisi sheet.'] };

  // Columns by header text, so a reordered or extra column is still read.
  const posisi = new Map<string, number>();
  ws.getRow(1).eachCell((cell, i) => {
    const judul = teks(mentah(cell.value)).replace(/\s*\*$/, '').toLowerCase();
    if (judul) posisi.set(judul, i);
  });
  const hilang = def.kolom.filter((c) => !posisi.has(c.judul.toLowerCase())).map((c) => c.judul);
  if (hilang.length) {
    return { rows: [], galatBerkas: [`Kolom tidak ditemukan di baris 1: ${hilang.join(', ')}. Gunakan template dari layar ini tanpa mengubah judul kolom.`] };
  }

  const rows: BarisMentah[] = [];
  ws.eachRow({ includeEmpty: false }, (row, nomor) => {
    if (nomor === 1) return;
    const nilai: Record<string, unknown> = {};
    let ada = false;
    for (const c of def.kolom) {
      const v = mentah(row.getCell(posisi.get(c.judul.toLowerCase())!).value);
      nilai[c.kunci] = v;
      if (teks(v) !== '') ada = true;
    }
    if (ada) rows.push({ baris: nomor, nilai });
  });

  if (rows.length === 0) return { rows, galatBerkas: ['Sheet "Data" belum berisi baris. Isi mulai baris 2.'] };
  if (rows.length > MAKS_BARIS) return { rows: [], galatBerkas: [`Maksimal ${MAKS_BARIS} baris per unggahan; file ini berisi ${rows.length}.`] };
  return { rows, galatBerkas: [] };
}
