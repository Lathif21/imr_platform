/**
 * Laporan per Kapal — "Rincian Kegiatan Operasional" of one ship in one
 * month, in the layout of the user's KM SANEI.pdf / TS 28.pdf (13 Oktober
 * 2026). Pure: the loader in $lib/server/laporan-kapal.ts reads the rows, the
 * screen, the printout and the Excel export all render what this returns.
 *
 * Three parts, one per printed page:
 *
 *   1. Invoices of the ship's kegiatan (Laporan Pendapatan, linked by
 *      operasional_rekap_id) and the operational costs:
 *        operasional telly = operasional_rekap.operasional (empty → 0, named)
 *        PBM               = 0, as Kumpulan — nothing stores it
 *        rekanan           = Σ tonase × ongkos angkut of the ship's trucks
 *        net pendapatan    = Σ pencairan (net tagihan) − total biaya
 *   2. The trucks per route, grouped per owner.
 *   3. What each owner is paid:
 *        net = bruto − uang saku − terpal − pajak
 *      as the user's sheets compute it. Pajak is the owner's rate for the
 *      month from Laporan Partner (0,5% when none is typed), rounded to whole
 *      rupiah once, on the owner's total — see $lib/operasional/pajak.ts.
 *
 * PPN has no column anywhere in the data; the printout keeps the column of
 * the user's layout and leaves it empty. Pencairan is net tagihan.
 */

import { TARIF_PAJAK_REKANAN, pajakRekanan } from './pajak';

export interface KegiatanSumber {
  id: number;
  kapal_id: number;
  nama_kapal: string;
  rute: string | null;
  voyage: string | null;
  /** null = biaya operasional belum diisi. */
  operasional: number | null;
}

export interface InvoiceSumber {
  operasional_rekap_id: number;
  no_urut: number | null;
  no_invoice: string | null;
  no_sto_spo: string | null;
  lokasi: string | null;
  party_kg: number;
  harga: number;
  total: number;
  tarif_pajak: number;
  pajak: number;
  net_tagihan: number;
}

export interface TrukSumber {
  id: number;
  operasional_rekap_id: number;
  nopol: string;
  pemilik_id: number | null;
  ritase: number;
  tonase: number;
  ongkos_angkut: number;
  /** transaksi_operasional.pendapatan — beban rekanan, tonase × ongkos angkut. */
  jumlah: number;
  saku: number;
  terpal: number;
}

export interface PemilikSumber {
  id: number;
  nama: string;
  rekening_atas_nama: string | null;
  no_rekening: string | null;
  nama_bank: string | null;
  /** This month's potongan pajak rate, from pajak_partner or the default. */
  persen_pajak: number;
}

export interface Jumlah {
  muat: number;
  rit: number;
  jumlah: number;
  saku: number;
  terpal: number;
}

export interface BarisInvoice {
  no_invoice: string | null;
  no_spo: string | null;
  rute: string;
  tonase: number;
  harga: number;
  tagihan: number;
  tarif_pajak: number;
  pajak: number;
  pencairan: number;
}

export interface BarisTruk {
  nopol: string;
  muat: number;
  rit: number;
  biaya_angkut: number;
  jumlah: number;
  saku: number;
  terpal: number;
}

export interface GrupPemilik {
  pemilik_id: number | null;
  nama: string;
  truk: BarisTruk[];
  jumlah: Jumlah;
}

export interface RuteKapal {
  kegiatan_id: number;
  rute: string;
  no_spo: string | null;
  pemilik: GrupPemilik[];
  jumlah: Jumlah;
}

export interface PembayaranRekanan {
  pemilik_id: number | null;
  nama: string;
  rute: { rute: string; muat: number; rit: number; bruto: number; saku: number; terpal: number }[];
  bruto: number;
  saku: number;
  terpal: number;
  persen_pajak: number;
  pajak: number;
  net: number;
  rekening_atas_nama: string | null;
  no_rekening: string | null;
  nama_bank: string | null;
}

export interface LaporanKapal {
  kapal_id: number;
  nama_kapal: string;
  /** Distinct voyages of the ship's kegiatan this month, "13" or "13 / 14"; null when none is filled in. */
  voyage: string | null;
  invoice: BarisInvoice[];
  jumlahInvoice: { tonase: number; tagihan: number; pajak: number; pencairan: number };
  biaya: { operasional: number; pbm: number; rekanan: number; total: number };
  net_pendapatan: number;
  rute: RuteKapal[];
  jumlahRekanan: Jumlah;
  pembayaran: PembayaranRekanan[];
  /** Gaps the reader must know about: costs not filled in, kegiatan without an invoice. */
  catatan: string[];
}

const kosong = (): Jumlah => ({ muat: 0, rit: 0, jumlah: 0, saku: 0, terpal: 0 });

function tambah(a: Jumlah, b: Jumlah | BarisTruk): Jumlah {
  return {
    muat: a.muat + b.muat,
    rit: a.rit + b.rit,
    jumlah: a.jumlah + b.jumlah,
    saku: a.saku + b.saku,
    terpal: a.terpal + b.terpal
  };
}

const teks = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t === '' || t === '-' ? null : t;
};

const urutNopol = (a: BarisTruk, b: BarisTruk) => a.nopol.localeCompare(b.nopol, 'id', { numeric: true });

/** One report per ship that has a kegiatan this month, sorted by ship name. */
export function susunLaporanKapal(input: {
  kegiatan: KegiatanSumber[];
  invoice: InvoiceSumber[];
  truk: TrukSumber[];
  pemilik: PemilikSumber[];
}): LaporanKapal[] {
  const pemilik = new Map(input.pemilik.map((p) => [p.id, p]));
  const invoicePerKegiatan = new Map<number, InvoiceSumber[]>();
  for (const i of input.invoice) {
    invoicePerKegiatan.set(i.operasional_rekap_id, [...(invoicePerKegiatan.get(i.operasional_rekap_id) ?? []), i]);
  }
  const trukPerKegiatan = new Map<number, TrukSumber[]>();
  for (const t of [...input.truk].sort((a, b) => a.id - b.id)) {
    trukPerKegiatan.set(t.operasional_rekap_id, [...(trukPerKegiatan.get(t.operasional_rekap_id) ?? []), t]);
  }

  const urutInvoice = (a: InvoiceSumber, b: InvoiceSumber) =>
    (a.no_urut ?? Number.MAX_SAFE_INTEGER) - (b.no_urut ?? Number.MAX_SAFE_INTEGER) ||
    (a.no_invoice ?? '').localeCompare(b.no_invoice ?? '', 'id', { numeric: true });

  const perKapal = new Map<number, KegiatanSumber[]>();
  for (const k of input.kegiatan) perKapal.set(k.kapal_id, [...(perKapal.get(k.kapal_id) ?? []), k]);

  const hasil: LaporanKapal[] = [];
  for (const [kapalId, kegiatanKapal] of perKapal) {
    // Kegiatan in the order of their invoice, so page 2 follows page 1;
    // kegiatan without an invoice last.
    const pertama = (k: KegiatanSumber) => [...(invoicePerKegiatan.get(k.id) ?? [])].sort(urutInvoice)[0];
    const kegiatan = [...kegiatanKapal].sort((a, b) => {
      const ia = pertama(a);
      const ib = pertama(b);
      if (ia && ib) return urutInvoice(ia, ib) || a.id - b.id;
      if (ia || ib) return ia ? -1 : 1;
      return a.id - b.id;
    });

    const catatan: string[] = [];
    // The invoice's lokasi is what the customer sees; the kegiatan's route
    // when there is none.
    const namaRute = (k: KegiatanSumber) => teks(pertama(k)?.lokasi) ?? teks(k.rute) ?? '-';

    const invoice: BarisInvoice[] = kegiatan.flatMap((k) =>
      [...(invoicePerKegiatan.get(k.id) ?? [])].sort(urutInvoice).map((i) => ({
        no_invoice: i.no_invoice,
        no_spo: teks(i.no_sto_spo),
        rute: teks(i.lokasi) ?? teks(k.rute) ?? '-',
        tonase: i.party_kg / 1000,
        harga: i.harga,
        tagihan: i.total,
        tarif_pajak: i.tarif_pajak,
        pajak: i.pajak,
        pencairan: i.net_tagihan
      }))
    );
    for (const k of kegiatan) {
      if (!invoicePerKegiatan.has(k.id)) catatan.push(`Kegiatan ${namaRute(k)} belum punya invoice di Laporan Pendapatan.`);
      if (k.operasional === null) catatan.push(`Biaya operasional kegiatan ${namaRute(k)} belum diisi (Lengkapi Data); dihitung Rp 0.`);
    }

    const rute: RuteKapal[] = kegiatan.map((k) => {
      const grup = new Map<number | null, GrupPemilik>();
      for (const t of trukPerKegiatan.get(k.id) ?? []) {
        const g =
          grup.get(t.pemilik_id) ??
          { pemilik_id: t.pemilik_id, nama: (t.pemilik_id !== null && pemilik.get(t.pemilik_id)?.nama) || '(Tanpa pemilik)', truk: [], jumlah: kosong() };
        const baris: BarisTruk = { nopol: t.nopol, muat: t.tonase, rit: t.ritase, biaya_angkut: t.ongkos_angkut, jumlah: t.jumlah, saku: t.saku, terpal: t.terpal };
        g.truk.push(baris);
        g.jumlah = tambah(g.jumlah, baris);
        grup.set(t.pemilik_id, g);
      }
      const pemilikRute = [...grup.values()];
      for (const g of pemilikRute) g.truk.sort(urutNopol);
      return {
        kegiatan_id: k.id,
        rute: namaRute(k),
        no_spo: teks(pertama(k)?.no_sto_spo),
        pemilik: pemilikRute,
        jumlah: pemilikRute.reduce((a, g) => tambah(a, g.jumlah), kosong())
      };
    });

    // Owners in the order they first appear on the ship, as on page 2.
    const bayar = new Map<number | null, PembayaranRekanan>();
    for (const r of rute) {
      for (const g of r.pemilik) {
        const p = g.pemilik_id === null ? undefined : pemilik.get(g.pemilik_id);
        const b =
          bayar.get(g.pemilik_id) ??
          {
            pemilik_id: g.pemilik_id,
            nama: g.nama,
            rute: [],
            bruto: 0,
            saku: 0,
            terpal: 0,
            persen_pajak: p?.persen_pajak ?? TARIF_PAJAK_REKANAN,
            pajak: 0,
            net: 0,
            rekening_atas_nama: teks(p?.rekening_atas_nama),
            no_rekening: teks(p?.no_rekening),
            nama_bank: teks(p?.nama_bank)
          };
        b.rute.push({ rute: r.rute, muat: g.jumlah.muat, rit: g.jumlah.rit, bruto: g.jumlah.jumlah, saku: g.jumlah.saku, terpal: g.jumlah.terpal });
        b.bruto += g.jumlah.jumlah;
        b.saku += g.jumlah.saku;
        b.terpal += g.jumlah.terpal;
        bayar.set(g.pemilik_id, b);
      }
    }
    const pembayaran = [...bayar.values()].map((b) => {
      const pajak = pajakRekanan(b.bruto, b.persen_pajak);
      return { ...b, pajak, net: b.bruto - b.saku - b.terpal - pajak };
    });

    const jumlahInvoice = invoice.reduce(
      (a, i) => ({ tonase: a.tonase + i.tonase, tagihan: a.tagihan + i.tagihan, pajak: a.pajak + i.pajak, pencairan: a.pencairan + i.pencairan }),
      { tonase: 0, tagihan: 0, pajak: 0, pencairan: 0 }
    );
    const jumlahRekanan = rute.reduce((a, r) => tambah(a, r.jumlah), kosong());
    const operasional = kegiatan.reduce((s, k) => s + (k.operasional ?? 0), 0);
    const biaya = { operasional, pbm: 0, rekanan: jumlahRekanan.jumlah, total: operasional + jumlahRekanan.jumlah };

    const voyage = [...new Set(kegiatan.map((k) => teks(k.voyage)).filter((v): v is string => v !== null))];

    hasil.push({
      kapal_id: kapalId,
      nama_kapal: kegiatan[0].nama_kapal,
      voyage: voyage.length ? voyage.join(' / ') : null,
      invoice,
      jumlahInvoice,
      biaya,
      net_pendapatan: jumlahInvoice.pencairan - biaya.total,
      rute,
      jumlahRekanan,
      pembayaran,
      catatan
    });
  }

  return hasil.sort((a, b) => a.nama_kapal.localeCompare(b.nama_kapal, 'id') || a.kapal_id - b.kapal_id);
}

/** "KM. SANEI VOY. 9" — the report's title line. */
export function judulKapal(l: Pick<LaporanKapal, 'nama_kapal' | 'voyage'>): string {
  return l.voyage ? `${l.nama_kapal} VOY. ${l.voyage}` : l.nama_kapal;
}

/** The tax column's label: "PAJAK PPh 21 (2%)" when every invoice uses one rate. */
export function labelPajakInvoice(invoice: BarisInvoice[]): string {
  const tarif = [...new Set(invoice.map((i) => i.tarif_pajak))];
  if (tarif.length !== 1) return 'PAJAK PPh 21';
  return `PAJAK PPh 21 (${tarif[0].toLocaleString('id-ID', { maximumFractionDigits: 2 })}%)`;
}
