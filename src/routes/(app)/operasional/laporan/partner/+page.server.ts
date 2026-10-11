import type { PageServerLoad } from './$types';
import { periodeDari } from '$lib/operasional/kegiatan';
import { jumlahPartner, muatPartner, type BarisPartner, type RingkasPartner } from '$lib/server/partner';
import { failLoad } from '$lib/server/operasional';

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const { opEntity } = await parent();
  const periode = periodeDari(url);
  const pemilikId = Number(url.searchParams.get('pemilik')) || null;
  const kosong = {
    periode,
    ringkas: [] as RingkasPartner[],
    dipilih: null as RingkasPartner | null,
    rincian: [] as BarisPartner[],
    jumlah: jumlahPartner([]),
    kegiatan: [] as { id: number; nama_kapal: string; rute: string | null; truk: number }[]
  };
  if (!opEntity) return kosong;

  const p = await muatPartner(locals.supabase, opEntity.id, periode);
  const dipilih = p.ringkas.find((r) => r.id === pemilikId) ?? null;
  const rincian = dipilih ? (p.perPemilik.get(dipilih.id) ?? []) : [];

  // Kegiatan of the month with their truck count, for the "Rincian
  // Pembayaran Truk" links Laravel listed on this page.
  const [rekapResult, kapalResult] = await Promise.all([
    locals.supabase
      .from('operasional_rekap')
      .select('id, kapal_id, rute')
      .eq('entity_id', opEntity.id)
      .eq('bulan', periode.bulan)
      .eq('tahun', periode.tahun)
      .returns<{ id: number; kapal_id: number; rute: string | null }[]>(),
    locals.supabase.from('kapal').select('id, nama_kapal').eq('entity_id', opEntity.id).returns<{ id: number; nama_kapal: string }[]>()
  ]);
  if (rekapResult.error) failLoad('partner kegiatan', rekapResult.error);
  if (kapalResult.error) failLoad('partner kapal', kapalResult.error);
  const rekap = rekapResult.data ?? [];
  const { data: truk, error: trukError } = await locals.supabase
    .from('transaksi_operasional')
    .select('operasional_rekap_id')
    .in('operasional_rekap_id', rekap.map((r) => r.id))
    .returns<{ operasional_rekap_id: number }[]>();
  if (trukError) failLoad('partner truk', trukError);
  const nama = new Map((kapalResult.data ?? []).map((k) => [k.id, k.nama_kapal]));

  return {
    ...kosong,
    ringkas: p.ringkas,
    dipilih,
    rincian,
    jumlah: jumlahPartner(rincian),
    kegiatan: rekap
      .map((r) => ({
        id: r.id,
        nama_kapal: nama.get(r.kapal_id) ?? '—',
        rute: r.rute,
        truk: (truk ?? []).filter((t) => t.operasional_rekap_id === r.id).length
      }))
      .sort((a, b) => a.nama_kapal.localeCompare(b.nama_kapal, 'id'))
  };
};
