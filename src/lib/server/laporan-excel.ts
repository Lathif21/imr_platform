/**
 * Excel export of the monthly operational reports — one report, or every
 * report of the month in one workbook (a sheet each). The numbers come from
 * the same loaders as the screens and printouts; nothing is computed here
 * that the screen does not compute.
 *
 * Amounts are written as numbers with a Rupiah format, dates as dates, so the
 * file stays usable in Excel and Google Sheets — sums and filters work.
 */
import ExcelJS from 'exceljs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NAMA_BULAN, type Periode } from '$lib/operasional/kegiatan';
import { pendapatanKartu, ringkasLabaRugi } from '$lib/operasional/kumpulan';
import { muatDetailKegiatan } from './detail-kegiatan';
import { muatGaji } from './gaji';
import { muatKumpulan } from './kumpulan';
import {
  muatLaporanKeuangan,
  muatLaporanOperasional,
  muatPaguyuban,
  muatRekapPendapatan,
  muatRekapPengeluaran
} from './laporan-operasional';
import { failLoad } from './operasional';
import { muatPartner } from './partner';

type Jenis = 'teks' | 'rp' | 'angka' | 'ton' | 'tanggal' | 'persen';

interface Kolom {
  judul: string;
  kunci: string;
  jenis?: Jenis;
  lebar?: number;
  /** Summed in the total row. */
  total?: boolean;
}

interface Tabel {
  judul?: string;
  kolom: Kolom[];
  /** Any row objects; columns pick their fields by `kunci`. */
  baris: object[];
}

export interface Lembar {
  nama: string;
  judul: string;
  tabel: Tabel[];
}

interface Konteks {
  db: SupabaseClient;
  entityId: string;
  periode: Periode;
}

const FORMAT: Record<Jenis, string | undefined> = {
  teks: undefined,
  rp: '"Rp" #,##0;[Red]-"Rp" #,##0',
  angka: '#,##0',
  ton: '#,##0.00#',
  tanggal: 'dd/mm/yyyy',
  persen: '0.0#"%"'
};

const LEBAR: Record<Jenis, number> = { teks: 24, rp: 16, angka: 9, ton: 11, tanggal: 12, persen: 8 };

/** "2026-12-05" → a date cell, at midnight UTC so no timezone shifts the day. */
function tanggal(v: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

function nilai(k: Kolom, v: unknown): ExcelJS.CellValue {
  if (v === null || v === undefined || v === '') return null;
  switch (k.jenis ?? 'teks') {
    case 'tanggal':
      return tanggal(v);
    case 'teks':
      return String(v);
    default:
      return Number(v);
  }
}

const ABU = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } } as const;
const TOTAL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } } as const;
const GARIS = { style: 'thin', color: { argb: 'FFD1D5DB' } } as const;

function tulisLembar(wb: ExcelJS.Workbook, l: Lembar, entitas: string, periode: Periode) {
  // Sheet names: max 31 chars, no []:*?/\ — Excel refuses the file otherwise.
  const ws = wb.addWorksheet(l.nama.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31));
  const lebarKolom = Math.max(1, ...l.tabel.map((t) => t.kolom.length));

  ws.addRow([l.judul]).font = { bold: true, size: 13 };
  ws.addRow([`${entitas} · ${NAMA_BULAN[periode.bulan - 1]} ${periode.tahun}`]).font = { color: { argb: 'FF4B5563' } };
  ws.addRow([`Diunduh dari IMR Platform, ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`]).font = {
    italic: true,
    size: 9,
    color: { argb: 'FF9CA3AF' }
  };

  const lebar = new Array<number>(lebarKolom).fill(8);
  for (const t of l.tabel) {
    ws.addRow([]);
    if (t.judul) ws.addRow([t.judul]).font = { bold: true, size: 11 };

    const head = ws.addRow(t.kolom.map((k) => k.judul));
    head.font = { bold: true };
    head.eachCell((c) => {
      c.fill = ABU;
      c.border = { bottom: GARIS };
      c.alignment = { vertical: 'middle', wrapText: true };
    });

    for (const b of t.baris) {
      const r = ws.addRow(t.kolom.map((k) => nilai(k, (b as Record<string, unknown>)[k.kunci])));
      t.kolom.forEach((k, i) => {
        const fmt = FORMAT[k.jenis ?? 'teks'];
        if (fmt) r.getCell(i + 1).numFmt = fmt;
      });
    }

    if (t.kolom.some((k) => k.total) && t.baris.length > 0) {
      const r = ws.addRow(
        t.kolom.map((k, i) =>
          k.total ? t.baris.reduce((s, b) => s + (Number((b as Record<string, unknown>)[k.kunci]) || 0), 0) : i === 0 ? 'TOTAL' : null
        )
      );
      r.font = { bold: true };
      t.kolom.forEach((k, i) => {
        const c = r.getCell(i + 1);
        c.fill = TOTAL;
        c.border = { top: GARIS };
        const fmt = FORMAT[k.jenis ?? 'teks'];
        if (fmt && k.total) c.numFmt = fmt;
      });
    }
    if (t.baris.length === 0) ws.addRow(['(tidak ada data bulan ini)']).font = { italic: true, color: { argb: 'FF9CA3AF' } };

    t.kolom.forEach((k, i) => (lebar[i] = Math.max(lebar[i], k.lebar ?? LEBAR[k.jenis ?? 'teks'])));
  }
  ws.columns = lebar.map((width) => ({ width }));
}

// ---------------------------------------------------------------------------
// One definition per report: its name, and the sheet(s) it produces.
// ---------------------------------------------------------------------------

const rentang = (a: string | null, b: string | null) => (a && b && a !== b ? `${a} s/d ${b}` : (a ?? ''));

async function muatPencairan({ db, entityId, periode }: Konteks) {
  const [cair, kapal] = await Promise.all([
    db
      .from('pencairan')
      .select('id, kapal_id, nomor_invoice, nominal_invoice, besaran_pajak, status')
      .eq('entity_id', entityId)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .order('nomor_invoice')
      .returns<{ id: number; kapal_id: number; nomor_invoice: string; nominal_invoice: string; besaran_pajak: string; status: string }[]>(),
    db.from('kapal').select('id, nama_kapal').eq('entity_id', entityId).returns<{ id: number; nama_kapal: string }[]>()
  ]);
  if (cair.error) failLoad('excel pencairan', cair.error);
  const rows = cair.data ?? [];
  const { data: appr, error } = await db
    .from('pencairan_approval')
    .select('pencairan_id, departemen, status, tanggal_ttd')
    .in('pencairan_id', rows.map((r) => r.id))
    .returns<{ pencairan_id: number; departemen: string; status: string; tanggal_ttd: string | null }[]>();
  if (error) failLoad('excel pencairan approval', error);
  const nama = new Map((kapal.data ?? []).map((k) => [k.id, k.nama_kapal]));
  const a = (id: number, d: string) => (appr ?? []).find((x) => x.pencairan_id === id && x.departemen === d);
  return rows.map((r) => ({
    nomor_invoice: r.nomor_invoice,
    kapal: nama.get(r.kapal_id) ?? '—',
    nominal: Number(r.nominal_invoice),
    pajak: Number(r.besaran_pajak),
    status: r.status,
    ...Object.fromEntries(
      ['Jetty', 'Gudang', 'Accounting'].flatMap((d) => [
        [`${d}_status`, a(r.id, d)?.status ?? 'Pending'],
        [`${d}_tgl`, a(r.id, d)?.tanggal_ttd ?? null]
      ])
    )
  }));
}

export const LAPORAN_EXCEL: Record<string, { label: string; lembar: (k: Konteks) => Promise<Lembar[]> }> = {
  kegiatan: {
    label: 'Detail Kegiatan Kapal',
    lembar: async ({ db, entityId, periode }) => {
      const rows = await muatDetailKegiatan(db, entityId, periode);
      return [
        {
          nama: 'Detail Kegiatan',
          judul: 'DETAIL KEGIATAN KAPAL',
          tabel: [
            {
              kolom: [
                { judul: 'Kapal', kunci: 'nama_kapal', lebar: 26 },
                { judul: 'Tanggal', kunci: 'tgl', lebar: 26 },
                { judul: 'Rute', kunci: 'rute', lebar: 28 },
                { judul: 'Truk', kunci: 'jumlah_truk', jenis: 'angka', total: true },
                { judul: 'Ritase', kunci: 'trips', jenis: 'angka', total: true },
                { judul: 'Tonase (MT)', kunci: 'tonase', jenis: 'ton', total: true },
                { judul: 'Saku Supir', kunci: 'sangu_supir', jenis: 'rp', total: true },
                { judul: 'Terpal', kunci: 'terpal', jenis: 'rp', total: true },
                { judul: 'Operasional', kunci: 'operasional', jenis: 'rp', total: true },
                { judul: 'Total', kunci: 'total', jenis: 'rp', total: true },
                { judul: 'Telly', kunci: 'telly' }
              ],
              baris: rows.map((r) => ({ ...r, tgl: rentang(r.tanggal_kegiatan, r.tanggal_selesai) }))
            }
          ]
        }
      ];
    }
  },

  kumpulan: {
    label: 'Kumpulan Laporan & Laba Rugi',
    lembar: async ({ db, entityId, periode }) => {
      const k = await muatKumpulan(db, entityId, periode);
      const lr = ringkasLabaRugi(k.cards, k.pengeluaran);
      return [
        {
          nama: 'Kumpulan',
          judul: 'KUMPULAN LAPORAN OPERASIONAL & LABA RUGI',
          tabel: [
            {
              judul: 'Rincian per kapal (invoice lunas)',
              kolom: [
                { judul: 'Kegiatan', kunci: 'kegiatan', lebar: 30 },
                { judul: 'Telly', kunci: 'telly', lebar: 18 },
                { judul: 'Muatan (MT)', kunci: 'muatan_mt', jenis: 'ton', total: true },
                { judul: 'Ritase', kunci: 'ritase', jenis: 'angka', total: true },
                { judul: 'Tagihan', kunci: 'tagihan', jenis: 'rp', total: true },
                { judul: 'Pajak', kunci: 'pajak', jenis: 'rp', total: true },
                { judul: 'Rekanan', kunci: 'rekanan', jenis: 'rp', total: true },
                { judul: 'Ongkos PBM', kunci: 'ongkos_pbm', jenis: 'rp', total: true },
                { judul: 'Terpal (50%)', kunci: 'terpal_50', jenis: 'rp', total: true },
                { judul: 'Operasional', kunci: 'operasional', jenis: 'rp', total: true },
                { judul: 'Pendapatan', kunci: 'pendapatan', jenis: 'rp', total: true }
              ],
              baris: k.cards.map((c) => ({ ...c, pendapatan: pendapatanKartu(c) }))
            },
            {
              judul: 'Laporan Laba Rugi',
              kolom: [
                { judul: 'Pos', kunci: 'pos', lebar: 30 },
                { judul: 'Jumlah', kunci: 'nilai', jenis: 'rp' }
              ],
              baris: [
                ['Tagihan Wilmar', lr.tagihan_wilmar],
                ['Pajak (0,5%)', lr.pajak],
                ['Rekanan', lr.rekanan],
                ['PBM', lr.pbm],
                ['Terpal (50%)', lr.terpal_50],
                ['Operasional Telly', lr.operasional_telly],
                ['Pendapatan Operasional', lr.pendapatan_operasional],
                ['Gaji Karyawan', lr.gaji_karyawan],
                ['Sewa Kantor', lr.sewa_kantor],
                ['PPh Sewa Kantor', lr.pph_sewa_kantor],
                ['Atensi Jalan', lr.atensi_jalan],
                ['Beban Kantor, ATK, dll', lr.beban_kantor],
                ['Pengeluaran Total', lr.total_pengeluaran],
                ['PENDAPATAN BERSIH', lr.pendapatan_bersih]
              ].map(([pos, nilai]) => ({ pos, nilai })).concat(k.notes ? [{ pos: `Catatan: ${k.notes}`, nilai: null as never }] : [])
            }
          ]
        }
      ];
    }
  },

  pendapatan: {
    label: 'Laporan Pendapatan',
    lembar: async ({ db, entityId, periode }) => {
      const { baris } = await muatRekapPendapatan(db, entityId, periode);
      return [
        {
          nama: 'Pendapatan',
          judul: 'REKAP INCOME (LAPORAN PENDAPATAN)',
          tabel: [
            {
              kolom: [
                { judul: 'No. Invoice', kunci: 'no_invoice', lebar: 20 },
                { judul: 'Kegiatan (Kapal)', kunci: 'kegiatan', lebar: 26 },
                { judul: 'No. Faktur Pajak', kunci: 'no_faktur_pajak', lebar: 18 },
                { judul: 'No. STO/SPO', kunci: 'no_sto_spo', lebar: 16 },
                { judul: 'Lokasi', kunci: 'lokasi', lebar: 24 },
                { judul: 'Tgl Kegiatan', kunci: 'tanggal_kegiatan', lebar: 22 },
                { judul: 'Party (KG)', kunci: 'party_kg', jenis: 'angka', lebar: 12, total: true },
                { judul: 'Harga /Ton', kunci: 'harga', jenis: 'rp' },
                { judul: 'Total', kunci: 'total', jenis: 'rp', total: true },
                { judul: 'Tarif Pajak', kunci: 'tarif_pajak', jenis: 'persen' },
                { judul: 'Pajak', kunci: 'pajak', jenis: 'rp', total: true },
                { judul: 'Net Tagihan', kunci: 'net_tagihan', jenis: 'rp', total: true },
                { judul: 'Status', kunci: 'status_entry', lebar: 18 },
                { judul: 'Tgl Entry', kunci: 'tanggal_entry', jenis: 'tanggal' },
                { judul: 'Payment Date', kunci: 'payment_date', jenis: 'tanggal' }
              ],
              baris
            }
          ]
        }
      ];
    }
  },

  pencairan: {
    label: 'Pencairan',
    lembar: async (k) => [
      {
        nama: 'Pencairan',
        judul: 'PENCAIRAN — PERSETUJUAN JETTY, GUDANG, ACCOUNTING',
        tabel: [
          {
            kolom: [
              { judul: 'No. Invoice', kunci: 'nomor_invoice', lebar: 20 },
              { judul: 'Kapal', kunci: 'kapal', lebar: 24 },
              { judul: 'Nominal', kunci: 'nominal', jenis: 'rp', total: true },
              { judul: 'Pajak', kunci: 'pajak', jenis: 'rp', total: true },
              { judul: 'Status Final', kunci: 'status', lebar: 12 },
              { judul: 'Jetty', kunci: 'Jetty_status', lebar: 10 },
              { judul: 'Tgl TTD Jetty', kunci: 'Jetty_tgl', jenis: 'tanggal' },
              { judul: 'Gudang', kunci: 'Gudang_status', lebar: 10 },
              { judul: 'Tgl TTD Gudang', kunci: 'Gudang_tgl', jenis: 'tanggal' },
              { judul: 'Accounting', kunci: 'Accounting_status', lebar: 11 },
              { judul: 'Tgl TTD Accounting', kunci: 'Accounting_tgl', jenis: 'tanggal' }
            ],
            baris: await muatPencairan(k)
          }
        ]
      }
    ]
  },

  partner: {
    label: 'Laporan Partner',
    lembar: async ({ db, entityId, periode }) => {
      const { ringkas, perPemilik } = await muatPartner(db, entityId, periode);
      const rincian = ringkas.flatMap((p) =>
        (perPemilik.get(p.id) ?? []).map((b) => ({ pemilik: p.nama, ...b, tgl: rentang(b.tanggal_kegiatan, b.tanggal_selesai) }))
      );
      return [
        {
          nama: 'Partner',
          judul: 'LAPORAN PARTNER (PEMBAYARAN PEMILIK KENDARAAN)',
          tabel: [
            {
              judul: 'Ringkasan per pemilik',
              kolom: [
                { judul: 'Pemilik', kunci: 'nama', lebar: 26 },
                { judul: 'Kendaraan', kunci: 'kendaraan', jenis: 'angka', total: true },
                { judul: 'Transaksi', kunci: 'transaksi', jenis: 'angka', total: true },
                { judul: 'Beban Rekanan', kunci: 'pendapatan', jenis: 'rp', total: true },
                { judul: 'Biaya', kunci: 'biaya', jenis: 'rp', total: true },
                { judul: 'Bersih', kunci: 'bersih', jenis: 'rp', total: true }
              ],
              baris: ringkas
            },
            {
              judul: 'Rincian per truk',
              kolom: [
                { judul: 'Pemilik', kunci: 'pemilik', lebar: 22 },
                { judul: 'Tanggal', kunci: 'tgl', lebar: 24 },
                { judul: 'Nopol', kunci: 'nopol', lebar: 12 },
                { judul: 'Kapal', kunci: 'kapal', lebar: 22 },
                { judul: 'Rute', kunci: 'rute', lebar: 24 },
                { judul: 'Ritase', kunci: 'ritase', jenis: 'angka', total: true },
                { judul: 'Tonase', kunci: 'tonase', jenis: 'ton', total: true },
                { judul: 'Ongkos /Ton', kunci: 'ongkos_angkut', jenis: 'rp' },
                { judul: 'Beban Rekanan', kunci: 'pendapatan', jenis: 'rp', total: true },
                { judul: 'Saku Supir', kunci: 'sangu_supir', jenis: 'rp', total: true },
                { judul: 'Terpal', kunci: 'terpal', jenis: 'rp', total: true },
                { judul: 'Bersih', kunci: 'bersih', jenis: 'rp', total: true }
              ],
              baris: rincian
            }
          ]
        }
      ];
    }
  },

  gaji: {
    label: 'Laporan Gaji Karyawan',
    lembar: async ({ db, entityId, periode }) => {
      const { ringkas } = await muatGaji(db, entityId, periode);
      return [
        {
          nama: 'Gaji',
          judul: 'LAPORAN GAJI KARYAWAN',
          tabel: [
            {
              kolom: [
                { judul: 'Nama', kunci: 'nama', lebar: 24 },
                { judul: 'Jabatan', kunci: 'jabatan', lebar: 16 },
                { judul: 'NPWP', kunci: 'npwp', lebar: 20 },
                { judul: 'Kegiatan', kunci: 'aktivitas', jenis: 'angka', total: true },
                { judul: 'Tonase', kunci: 'tonase', jenis: 'ton', total: true },
                { judul: 'Gaji Kotor', kunci: 'gaji_kotor', jenis: 'rp', total: true },
                { judul: 'PPh', kunci: 'pph', jenis: 'rp', total: true },
                { judul: 'Gaji Bersih', kunci: 'gaji_bersih', jenis: 'rp', total: true }
              ],
              baris: ringkas
            }
          ]
        }
      ];
    }
  },

  paguyuban: {
    label: 'Laporan Paguyuban',
    lembar: async ({ db, entityId, periode }) => {
      const { grup, baris } = await muatPaguyuban(db, entityId, periode);
      const namaGrup = new Map(grup.map((g) => [g.kunci, g.nama]));
      return [
        {
          nama: 'Paguyuban',
          judul: 'LAPORAN PAGUYUBAN',
          tabel: [
            {
              judul: 'Per kelompok',
              kolom: [
                { judul: 'Paguyuban', kunci: 'nama', lebar: 26 },
                { judul: 'Kapal', kunci: 'kapal', jenis: 'angka', total: true },
                { judul: 'Transaksi', kunci: 'transaksi', jenis: 'angka', total: true },
                { judul: 'Tonase', kunci: 'tonase', jenis: 'ton', total: true },
                { judul: 'Iuran', kunci: 'total', jenis: 'rp', total: true }
              ],
              baris: grup
            },
            {
              judul: 'Rincian iuran',
              kolom: [
                { judul: 'Paguyuban', kunci: 'paguyuban', lebar: 24 },
                { judul: 'Tanggal', kunci: 'tanggal', jenis: 'tanggal' },
                { judul: 'Kapal', kunci: 'kapal', lebar: 22 },
                { judul: 'Nopol', kunci: 'nopol', lebar: 12 },
                { judul: 'Tonase', kunci: 'tonase', jenis: 'ton', total: true },
                { judul: 'Tarif', kunci: 'tarif', jenis: 'rp' },
                { judul: 'Iuran', kunci: 'total', jenis: 'rp', total: true }
              ],
              baris: baris.map((b) => ({ ...b, paguyuban: namaGrup.get(b.kunci) ?? b.kunci }))
            }
          ]
        }
      ];
    }
  },

  operasional: {
    label: 'Laporan Operasional',
    lembar: async ({ db, entityId, periode }) => {
      const { ringkas } = await muatLaporanOperasional(db, entityId, periode);
      return [
        {
          nama: 'Operasional',
          judul: 'LAPORAN OPERASIONAL — REKAP PER KAPAL',
          tabel: [
            {
              kolom: [
                { judul: 'Kapal', kunci: 'nama_kapal', lebar: 26 },
                { judul: 'Kegiatan', kunci: 'kegiatan', jenis: 'angka', total: true },
                { judul: 'Truk', kunci: 'truk', jenis: 'angka', total: true },
                { judul: 'Ritase', kunci: 'ritase', jenis: 'angka', total: true },
                { judul: 'Tonase', kunci: 'tonase', jenis: 'ton', total: true },
                { judul: 'Beban Rekanan', kunci: 'rekanan', jenis: 'rp', total: true },
                { judul: 'Saku Supir', kunci: 'sangu_supir', jenis: 'rp', total: true },
                { judul: 'Terpal', kunci: 'terpal', jenis: 'rp', total: true },
                { judul: 'Operasional', kunci: 'operasional', jenis: 'rp', total: true },
                { judul: 'Paguyuban', kunci: 'paguyuban', jenis: 'rp', total: true },
                { judul: 'Honor Telly', kunci: 'telly', jenis: 'rp', total: true },
                { judul: 'Total Biaya', kunci: 'total', jenis: 'rp', total: true }
              ],
              baris: ringkas
            }
          ]
        }
      ];
    }
  },

  keuangan: {
    label: 'Laporan Keuangan',
    lembar: async ({ db, entityId, periode }) => {
      const { transaksi, pengeluaran } = await muatLaporanKeuangan(db, entityId, periode);
      return [
        {
          nama: 'Keuangan',
          judul: 'LAPORAN KEUANGAN — RINCIAN TRUK DAN PENGELUARAN',
          tabel: [
            {
              judul: 'Rincian truk',
              kolom: [
                { judul: 'Tanggal', kunci: 'tanggal', jenis: 'tanggal' },
                { judul: 'Kapal', kunci: 'kapal', lebar: 24 },
                { judul: 'Nopol', kunci: 'nopol', lebar: 12 },
                { judul: 'Beban Rekanan', kunci: 'rekanan', jenis: 'rp', total: true },
                { judul: 'Biaya Lapangan', kunci: 'biaya', jenis: 'rp', total: true }
              ],
              baris: transaksi
            },
            {
              judul: 'Pengeluaran',
              kolom: [
                { judul: 'Tanggal', kunci: 'tanggal', jenis: 'tanggal' },
                { judul: 'Jenis', kunci: 'jenis', lebar: 24 },
                { judul: 'Nama Kegiatan', kunci: 'nama_kegiatan', lebar: 24 },
                { judul: 'Penerima', kunci: 'penerima', lebar: 18 },
                { judul: 'Jumlah', kunci: 'jumlah', jenis: 'rp', total: true }
              ],
              baris: pengeluaran
            }
          ]
        }
      ];
    }
  },

  pengeluaran: {
    label: 'Laporan Pengeluaran',
    lembar: async ({ db, entityId, periode }) => {
      const { baris } = await muatRekapPengeluaran(db, entityId, periode);
      return [
        {
          nama: 'Pengeluaran',
          judul: 'REKAPAN PENGELUARAN',
          tabel: [
            {
              kolom: [
                { judul: 'Tanggal', kunci: 'tanggal', jenis: 'tanggal' },
                { judul: 'Jenis', kunci: 'jenis', lebar: 24 },
                { judul: 'Nama Kegiatan', kunci: 'nama_kegiatan', lebar: 24 },
                { judul: 'Penerima', kunci: 'penerima', lebar: 18 },
                { judul: 'Keterangan', kunci: 'keterangan', lebar: 28 },
                { judul: 'Jumlah', kunci: 'jumlah', jenis: 'rp', total: true }
              ],
              baris: [...baris].reverse()
            }
          ]
        }
      ];
    }
  }
};

/** Report keys in workbook order. */
export const URUTAN_LAPORAN = Object.keys(LAPORAN_EXCEL);

export async function bukuLaporan(k: Konteks, entitas: string, kunci: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IMR Platform';
  wb.created = new Date();
  for (const key of kunci) {
    for (const l of await LAPORAN_EXCEL[key].lembar(k)) tulisLembar(wb, l, entitas, k.periode);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
