/**
 * The one kegiatan the Lengkapi Data and Rincian Pembayaran pages open.
 * Not a repository layer (CLAUDE.md) — only the lookup both pages share,
 * including the rule that another entity's kegiatan is "not found".
 */

import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { failLoad } from './operasional';

export interface KegiatanDetail {
  id: number;
  bulan: number;
  tahun: number;
  nama_kapal: string;
  rute: string | null;
  /** `null` = belum diisi; 0 = diisi Rp 0. */
  operasional: number | null;
  telly_id: number | null;
  tanggal_input: string | null;
  tanggal_kegiatan: string | null;
  tanggal_selesai: string | null;
  keterangan: string | null;
}

export async function muatKegiatan(
  db: SupabaseClient,
  id: string,
  entityId: string
): Promise<KegiatanDetail> {
  if (!/^\d+$/.test(id)) error(404, 'Kegiatan tidak ditemukan.');

  const { data, error: err } = await db
    .from('operasional_rekap')
    .select('id, entity_id, bulan, tahun, kapal_id, rute, operasional, telly_id, tanggal_input, tanggal_kegiatan, tanggal_selesai, keterangan')
    .eq('id', Number(id))
    .maybeSingle<Omit<KegiatanDetail, 'nama_kapal' | 'operasional'> & { entity_id: string; kapal_id: number; operasional: string | null }>();
  if (err) failLoad('operasional_rekap', err);
  // Another entity's kegiatan, or one this account may not read: the same
  // answer, so the page does not confirm that the id exists.
  if (!data || data.entity_id !== entityId) error(404, 'Kegiatan tidak ditemukan di entitas ini.');

  const { data: kapal } = await db.from('kapal').select('nama_kapal').eq('id', data.kapal_id).maybeSingle<{ nama_kapal: string }>();

  return {
    id: data.id,
    bulan: data.bulan,
    tahun: data.tahun,
    nama_kapal: kapal?.nama_kapal ?? '—',
    rute: data.rute,
    operasional: data.operasional === null ? null : Number(data.operasional),
    telly_id: data.telly_id,
    tanggal_input: data.tanggal_input,
    tanggal_kegiatan: data.tanggal_kegiatan,
    tanggal_selesai: data.tanggal_selesai,
    keterangan: data.keterangan
  };
}

