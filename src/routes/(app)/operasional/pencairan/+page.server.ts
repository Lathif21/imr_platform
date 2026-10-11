import type { Actions, PageServerLoad } from './$types';
import { bacaRupiah, periodeDari } from '$lib/operasional/kegiatan';
import { DEPARTEMEN, type Approval, type StatusPencairan as Status } from '$lib/operasional/pencairan';
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
 * Pencairan — PencairanController. Invoice per kapal, approved in stages by
 * Jetty, Gudang and Accounting; the approval drives the matching Laporan
 * Pendapatan row from PENDING to PROSES PAYMENT. All writes go through the
 * functions of migration 20250114.
 *
 * Laravel's index() also SYNCED on every GET: it created a pencairan for
 * each revenue invoice (kapal guessed by name, else the first kapal) and
 * DELETED every pencairan whose invoice was not in Laporan Pendapatan. That
 * is not ported. Pulling invoices from Laporan Pendapatan belongs with that
 * screen (Fase 4), as an explicit action.
 */

export interface PencairanRow {
  id: number;
  kapal_id: number;
  nama_kapal: string;
  bulan: number;
  tahun: number;
  nomor_invoice: string;
  nominal_invoice: number;
  besaran_pajak: number;
  status: Status;
  created_at: string;
  approvals: Approval[];
  /** Matching Laporan Pendapatan row, for the BA preview in the approval form. */
  laporan: {
    kegiatan: string;
    party_kg: number;
    lokasi: string | null;
    no_faktur_pajak: string | null;
    no_sto_spo: string | null;
    tarif_pajak: number;
    pajak: number;
    total: number;
    net_tagihan: number;
    status_entry: string | null;
    created_at: string;
  } | null;
}

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  const kosong = { periode, pencairan: [] as PencairanRow[], daftarKapal: [] as { id: number; nama: string }[] };
  if (!opEntity) return kosong;
  const db = locals.supabase;

  const [pencairanResult, kapalResult] = await Promise.all([
    db
      .from('pencairan')
      .select('id, kapal_id, bulan, tahun, nomor_invoice, nominal_invoice, besaran_pajak, status, created_at')
      .eq('entity_id', opEntity.id)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .order('created_at', { ascending: false })
      .returns<
        (Omit<PencairanRow, 'nama_kapal' | 'approvals' | 'laporan' | 'nominal_invoice' | 'besaran_pajak'> & {
          nominal_invoice: string;
          besaran_pajak: string;
        })[]
      >(),
    db.from('kapal').select('id, nama_kapal').eq('entity_id', opEntity.id).order('nama_kapal').returns<{ id: number; nama_kapal: string }[]>()
  ]);
  if (pencairanResult.error) failLoad('pencairan', pencairanResult.error);
  if (kapalResult.error) failLoad('kapal', kapalResult.error);

  const pencairan = pencairanResult.data ?? [];
  const ids = pencairan.map((p) => p.id);
  const invoices = pencairan.map((p) => p.nomor_invoice);

  const [approvalResult, laporanResult] = await Promise.all([
    db
      .from('pencairan_approval')
      .select('pencairan_id, departemen, status, tanggal_ttd, keterangan')
      .in('pencairan_id', ids)
      .returns<(Approval & { pencairan_id: number })[]>(),
    db
      .from('laporan_pendapatan')
      .select('no_invoice, kegiatan, party_kg, lokasi, no_faktur_pajak, no_sto_spo, tarif_pajak, pajak, total, net_tagihan, status_entry, created_at')
      .eq('entity_id', opEntity.id)
      .in('no_invoice', invoices)
      .returns<Record<string, string | null>[]>()
  ]);
  if (approvalResult.error) failLoad('pencairan_approval', approvalResult.error);
  if (laporanResult.error) failLoad('laporan_pendapatan', laporanResult.error);

  const namaKapal = new Map((kapalResult.data ?? []).map((k) => [k.id, k.nama_kapal]));
  const laporan = new Map((laporanResult.data ?? []).map((l) => [l.no_invoice, l]));
  const approvals = new Map<number, Approval[]>();
  for (const a of approvalResult.data ?? []) {
    approvals.set(a.pencairan_id, [...(approvals.get(a.pencairan_id) ?? []), a]);
  }

  return {
    ...kosong,
    daftarKapal: (kapalResult.data ?? []).map((k) => ({ id: k.id, nama: k.nama_kapal })),
    pencairan: pencairan.map((p): PencairanRow => {
      const l = laporan.get(p.nomor_invoice);
      const own = approvals.get(p.id) ?? [];
      return {
        ...p,
        nominal_invoice: Number(p.nominal_invoice),
        besaran_pajak: Number(p.besaran_pajak),
        nama_kapal: namaKapal.get(p.kapal_id) ?? '—',
        approvals: DEPARTEMEN.map(
          (d) => own.find((a) => a.departemen === d) ?? { departemen: d, status: 'Pending', tanggal_ttd: null, keterangan: null }
        ),
        laporan: l
          ? {
              kegiatan: l.kegiatan ?? '',
              party_kg: Number(l.party_kg ?? 0),
              lokasi: l.lokasi,
              no_faktur_pajak: l.no_faktur_pajak,
              no_sto_spo: l.no_sto_spo,
              tarif_pajak: Number(l.tarif_pajak ?? 0),
              pajak: Number(l.pajak ?? 0),
              total: Number(l.total ?? 0),
              net_tagihan: Number(l.net_tagihan ?? 0),
              status_entry: l.status_entry,
              created_at: l.created_at ?? p.created_at
            }
          : null
      };
    })
  };
};

export const actions: Actions = {
  simpan: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    const kapalId = idFrom(form, 'kapal_id');
    const bulan = Number(requiredText(form, 'bulan'));
    const tahun = Number(requiredText(form, 'tahun'));
    const nomor = requiredText(form, 'nomor_invoice');
    const nominalText = String(form.get('nominal_invoice') ?? '');
    const nominal = bacaRupiah(nominalText);
    const pajak = bacaRupiah(String(form.get('besaran_pajak') ?? ''));

    const details: string[] = [];
    if (kapalId === null) details.push('Kapal wajib dipilih.');
    if (!Number.isInteger(bulan) || bulan < 1 || bulan > 12) details.push('Bulan wajib dipilih.');
    if (!Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) details.push('Tahun tidak sah.');
    if (nomor === '') details.push('Nomor invoice wajib diisi.');
    if (nomor.length > 255) details.push('Nomor invoice maksimal 255 karakter.');
    if (nominal === null || nominalText.trim() === '') details.push('Nominal invoice wajib diisi dengan angka rupiah.');
    if (pajak === null) details.push('Besaran pajak harus berupa angka rupiah.');
    if (nominal !== null && pajak !== null && pajak > nominal) details.push('Besaran pajak tidak boleh melebihi nominal invoice.');
    if (details.length) return invalid(details);

    const { error } = await locals.supabase.rpc('simpan_pencairan', {
      p_entity_id: requiredText(form, 'entity_id'),
      p_id: id,
      p_kapal_id: kapalId,
      p_bulan: bulan,
      p_tahun: tahun,
      p_nomor: nomor,
      p_nominal: nominal,
      p_pajak: pajak
    });
    if (error) {
      return refuse(
        explainDbError('simpan_pencairan', error, {
          duplicate: `Nomor invoice ${nomor} sudah terdaftar.`,
          fallback: 'Invoice pencairan gagal disimpan.'
        })
      );
    }

    return id === null
      ? { title: 'Berhasil disimpan', message: `Invoice ${nomor} berhasil ditambahkan dan disinkronkan ke Pendapatan Bulanan.` }
      : { title: 'Berhasil diperbarui', message: `Invoice ${nomor} berhasil diperbarui.` };
  },

  setujui: async ({ locals, request }) => {
    const form = await request.formData();
    const id = idFrom(form);
    const departemen = requiredText(form, 'departemen');
    const status = requiredText(form, 'status');
    const tanggal = optionalText(form, 'tanggal_ttd');

    const details: string[] = [];
    if (id === null) details.push('Invoice tidak dikenali.');
    if (!(DEPARTEMEN as readonly string[]).includes(departemen)) details.push('Departemen tidak dikenali.');
    if (!['Pending', 'Approved', 'Rejected'].includes(status)) details.push('Status persetujuan wajib dipilih.');
    if (tanggal !== null && !ISO_DATE.test(tanggal)) details.push('Tanggal tanda tangan tidak sah.');
    if (details.length) return invalid(details);

    const { data, error } = await locals.supabase.rpc('setujui_pencairan', {
      p_pencairan_id: id,
      p_departemen: departemen,
      p_status: status,
      p_tanggal_ttd: tanggal,
      p_keterangan: optionalText(form, 'keterangan')
    });
    if (error) return refuse(explainDbError('setujui_pencairan', error, { fallback: 'Status persetujuan gagal diperbarui.' }));

    return {
      title: 'Berhasil diperbarui',
      message:
        data === 'Approved'
          ? 'Ketiga departemen telah menyetujui. Invoice masuk Proses Payment di Pendapatan Bulanan.'
          : `Persetujuan ${departemen} berhasil diperbarui. Status invoice: ${data}.`
    };
  },

  hapus: async ({ locals, request }) => {
    const id = idFrom(await request.formData());
    if (id === null) return refuse('Invoice yang akan dihapus tidak dikenali.');
    const { error } = await locals.supabase.rpc('hapus_pencairan', { p_pencairan_id: id });
    if (error) return refuse(explainDbError('hapus_pencairan', error, { fallback: 'Invoice pencairan gagal dihapus.' }));
    return { title: 'Berhasil dihapus', message: 'Invoice pencairan berhasil dihapus.' };
  }
};
