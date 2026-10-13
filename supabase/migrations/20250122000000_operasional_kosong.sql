-- =====================================================================
--  Biaya operasional kegiatan: "belum diisi" berbeda dengan Rp 0
--
--  operasional_rekap.operasional dulu NOT NULL DEFAULT 0, jadi kegiatan
--  yang biaya operasionalnya sengaja diisi 0 tampil "Belum diisi" di
--  Detail Kegiatan Kapal, sama dengan kegiatan yang belum disentuh.
--
--  Sekarang:
--    NULL  belum diisi (kegiatan baru, kolom dikosongkan, impor kosong)
--    0     diisi Rp 0
--
--  Data lama bernilai 0 menjadi NULL, sehingga tampilannya tidak berubah
--  ("Belum diisi"); kegiatan yang memang 0 cukup disimpan ulang dengan 0.
--  P&L tidak berubah: COGS_OPS sudah coalesce(operasional, 0)
--  (20250121_pnl_dari_operasional).
-- =====================================================================

alter table operasional_rekap
  alter column operasional drop not null,
  alter column operasional drop default;

update operasional_rekap set operasional = null where operasional = 0;

comment on column operasional_rekap.operasional is
  'Biaya operasional kegiatan. NULL = belum diisi; 0 = diisi Rp 0.';


-- ---------------------------------------------------------------------
--  Tambah Data General: kegiatan baru belum punya biaya operasional.
-- ---------------------------------------------------------------------

create or replace function tambah_kegiatan(
  p_entity_id        uuid,
  p_nama_kapal       text,
  p_bulan            int,
  p_tahun            int,
  p_tanggal_input    date,
  p_tanggal_kegiatan date,
  p_tanggal_selesai  date,
  p_keterangan       text
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kapal bigint;
  v_id bigint;
begin
  v_kapal := kapal_menurut_nama(p_entity_id, p_nama_kapal);

  insert into operasional_rekap (
    entity_id, bulan, tahun, kapal_id, rute, trips, tonase, sangu_supir, terpal, operasional,
    tanggal_input, tanggal_kegiatan, tanggal_selesai, keterangan
  ) values (
    p_entity_id, p_bulan, p_tahun, v_kapal, 'Kapal/Pelabuhan', 0, 0, 0, 0, null,
    coalesce(p_tanggal_input, current_date), p_tanggal_kegiatan, p_tanggal_selesai, p_keterangan
  )
  returning id into v_id;

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
--  Lengkapi Data: p_operasional NULL disimpan NULL, bukan 0.
-- ---------------------------------------------------------------------

create or replace function simpan_rincian_kegiatan(
  p_rekap_id         bigint,
  p_rute             text,
  p_operasional      numeric,
  p_telly_id         bigint,
  p_tanggal_input    date,
  p_tanggal_kegiatan date,
  p_tanggal_selesai  date,
  p_keterangan       text,
  p_truk             jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r operasional_rekap;
  v_tanggal date;
  v_item jsonb;
  v_nopol text;
  v_kendaraan bigint;
  v_pemilik bigint;
  v_pemilik_baru text;
  v_transaksi bigint;
  v_kept bigint[] := '{}';
  v_truk_kept bigint[] := '{}';
begin
  select * into r from operasional_rekap where id = p_rekap_id for update;
  if not found then
    raise exception 'Kegiatan tidak ditemukan, atau akun Anda tidak berwenang mengubahnya.';
  end if;

  update operasional_rekap
     set rute             = p_rute,
         operasional      = p_operasional,
         telly_id         = p_telly_id,
         tanggal_input    = coalesce(p_tanggal_input, tanggal_input, current_date),
         tanggal_kegiatan = p_tanggal_kegiatan,
         tanggal_selesai  = p_tanggal_selesai,
         keterangan       = p_keterangan
   where id = r.id
  returning * into r;
  if not found then
    raise exception 'Akun Anda tidak berwenang mengubah data operasional entitas ini.';
  end if;

  v_tanggal := tanggal_truk_kegiatan(r.bulan, r.tahun, r.tanggal_kegiatan);

  for v_item in select * from jsonb_array_elements(coalesce(p_truk, '[]'::jsonb)) loop
    v_nopol := upper(regexp_replace(btrim(coalesce(v_item->>'nopol', '')), '\s+', ' ', 'g'));
    if v_nopol = '' then
      continue;
    end if;

    select id into v_kendaraan from kendaraan where entity_id = r.entity_id and upper(nopol) = v_nopol;

    if v_kendaraan is null then
      v_pemilik := nullif(v_item->>'pemilik_id', '')::bigint;
      v_pemilik_baru := regexp_replace(btrim(coalesce(v_item->>'pemilik_baru', '')), '\s+', ' ', 'g');

      if v_pemilik is not null then
        perform 1 from pemilik where id = v_pemilik and entity_id = r.entity_id;
        if not found then
          raise exception 'Pemilik untuk truk % tidak ditemukan di entitas ini.', v_nopol;
        end if;
      elsif v_pemilik_baru <> '' then
        select id into v_pemilik
          from pemilik
         where entity_id = r.entity_id and nama_banding(nama_pemilik) = nama_banding(v_pemilik_baru)
         order by id limit 1;
        if v_pemilik is null then
          insert into pemilik (entity_id, nama_pemilik) values (r.entity_id, v_pemilik_baru)
          returning id into v_pemilik;
        end if;
      else
        raise exception 'Truk % belum terdaftar. Pilih atau isi nama pemiliknya.', v_nopol;
      end if;

      insert into kendaraan (entity_id, nopol, pemilik_id) values (r.entity_id, v_nopol, v_pemilik)
      returning id into v_kendaraan;
    end if;

    if v_kendaraan = any (v_truk_kept) then
      raise exception 'Truk % tercantum lebih dari sekali pada kegiatan ini.', v_nopol;
    end if;
    v_truk_kept := v_truk_kept || v_kendaraan;

    update transaksi_operasional
       set kapal_id         = r.kapal_id,
           rute             = coalesce(r.rute, '-'),
           tanggal          = v_tanggal,
           tanggal_kegiatan = r.tanggal_kegiatan,
           tanggal_selesai  = r.tanggal_selesai,
           ritase           = coalesce((v_item->>'ritase')::int, 0),
           tonase           = coalesce((v_item->>'tonase')::numeric, 0),
           pendapatan       = case
                                when ongkos_angkut > 0
                                then coalesce((v_item->>'tonase')::numeric, 0) * ongkos_angkut
                                else pendapatan
                              end,
           telly_id         = r.telly_id,
           keterangan       = r.keterangan
     where operasional_rekap_id = r.id and kendaraan_id = v_kendaraan
    returning id into v_transaksi;

    if v_transaksi is null then
      insert into transaksi_operasional (
        entity_id, tanggal, tanggal_kegiatan, tanggal_selesai, tanggal_input,
        kapal_id, operasional_rekap_id, kendaraan_id, rute, ritase, tonase,
        ongkos_angkut, pendapatan, sangu_supir, terpal, operasional, telly_id, keterangan
      ) values (
        r.entity_id, v_tanggal, r.tanggal_kegiatan, r.tanggal_selesai, r.tanggal_input,
        r.kapal_id, r.id, v_kendaraan, coalesce(r.rute, '-'),
        coalesce((v_item->>'ritase')::int, 0), coalesce((v_item->>'tonase')::numeric, 0),
        0, 0, 0, 0, 0, r.telly_id, r.keterangan
      )
      returning id into v_transaksi;
    end if;

    v_kept := v_kept || v_transaksi;
    perform sinkron_paguyuban(v_transaksi);

    v_kendaraan := null;
    v_transaksi := null;
  end loop;

  -- Truk yang dikeluarkan dari daftar. Paguyuban dan honor telly per
  -- transaksi ikut lewat FK CASCADE.
  delete from transaksi_operasional where operasional_rekap_id = r.id and id <> all (v_kept);

  perform hitung_ulang_kegiatan(r.id);
end;
$$;


-- ---------------------------------------------------------------------
--  Impor Excel: kolom Biaya Operasional yang kosong tetap "belum diisi".
-- ---------------------------------------------------------------------

create or replace function impor_kegiatan(p_entity_id uuid, p_kegiatan jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  k jsonb;
  v_id bigint;
  v_bayar jsonb;
  v_n int := 0;
begin
  perform impor_wajib_boleh_tulis(p_entity_id);
  for k in select * from jsonb_array_elements(coalesce(p_kegiatan, '[]'::jsonb)) loop
    if nullif(k->>'timpa_id', '') is not null then
      v_id := (k->>'timpa_id')::bigint;
      perform 1 from operasional_rekap where id = v_id and entity_id = p_entity_id;
      if not found then
        raise exception 'Kegiatan % yang akan ditimpa tidak ditemukan.', k->>'nama_kapal';
      end if;
      perform ubah_kegiatan(v_id, k->>'nama_kapal', (k->>'bulan')::int, (k->>'tahun')::int,
                            nullif(k->>'tanggal_input', '')::date, nullif(k->>'tanggal_kegiatan', '')::date,
                            nullif(k->>'tanggal_selesai', '')::date);
    else
      v_id := tambah_kegiatan(p_entity_id, k->>'nama_kapal', (k->>'bulan')::int, (k->>'tahun')::int,
                              nullif(k->>'tanggal_input', '')::date, nullif(k->>'tanggal_kegiatan', '')::date,
                              nullif(k->>'tanggal_selesai', '')::date, nullif(btrim(k->>'keterangan'), ''));
    end if;

    perform simpan_rincian_kegiatan(
      v_id, nullif(btrim(k->>'rute'), ''), nullif(k->>'operasional', '')::numeric,
      nullif(k->>'telly_id', '')::bigint, nullif(k->>'tanggal_input', '')::date,
      nullif(k->>'tanggal_kegiatan', '')::date, nullif(k->>'tanggal_selesai', '')::date,
      nullif(btrim(k->>'keterangan'), ''), coalesce(k->'truk', '[]'::jsonb)
    );

    -- Ongkos, saku, terpal per truk: the rows simpan_rincian_kegiatan just
    -- wrote, matched by nopol.
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', tr.id,
             'ritase', coalesce((t2->>'ritase')::int, 0),
             'tonase', coalesce((t2->>'tonase')::numeric, 0),
             'ongkos_angkut', coalesce(nullif(t2->>'ongkos_angkut', '')::numeric, 0),
             'sangu_supir', coalesce(nullif(t2->>'sangu_supir', '')::numeric, 0),
             'terpal', coalesce(nullif(t2->>'terpal', '')::numeric, 0))), '[]'::jsonb)
      into v_bayar
      from transaksi_operasional tr
      join kendaraan kd on kd.id = tr.kendaraan_id
      join lateral (
        select el.value from jsonb_array_elements(coalesce(k->'truk', '[]'::jsonb)) el
         where upper(regexp_replace(btrim(el.value->>'nopol'), '\s+', ' ', 'g')) = upper(kd.nopol)
         limit 1
      ) m(t2) on true
     where tr.operasional_rekap_id = v_id;
    if jsonb_array_length(v_bayar) > 0 then
      perform simpan_pembayaran_truk(v_id, v_bayar);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
