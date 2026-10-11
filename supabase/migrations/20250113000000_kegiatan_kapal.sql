-- =====================================================================
--  KEGIATAN KAPAL (Fase 2)
--
--  Database General, Detail Kegiatan Kapal, Lengkapi Data Kegiatan, dan
--  Rincian Pembayaran Truk menulis ke empat-lima tabel sekaligus: kegiatan
--  (operasional_rekap), truk (transaksi_operasional), kendaraan dan
--  pemilik baru, iuran paguyuban, dan honor telly per kegiatan. Laravel
--  menulisnya berurutan tanpa transaksi; di sini setiap simpan adalah
--  satu fungsi, sehingga tidak pernah tersimpan setengah.
--
--  Semua fungsi security invoker: RLS pemanggil tetap berlaku (hanya
--  admin_operasional yang ditugaskan ke entitas itu yang bisa menulis),
--  dan trigger audit serta stamp_operational_actor tetap berjalan.
--
--  Rumus dipindah apa adanya dari Laravel (OperasionalController,
--  LaporanController::updatePembayaranBulk, Paguyuban::sinkronkan).
--  Perbedaannya, masing-masing ditandai PERBAIKAN di bawah dan dicatat
--  di docs/PENGGABUNGAN.md, hanya pada hal yang merusak data.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Honor telly per kegiatan ikut terhapus bersama kegiatannya.
--
--  SET NULL meninggalkan baris tanpa transaksi_id maupun
--  operasional_rekap_id — bentuk yang dibaca sebagai GAJI ADMIN. Laravel
--  selalu menghapusnya bersama kegiatan; hapus_kapal() (20250112) sudah
--  melakukannya dengan tangan. CASCADE membuatnya berlaku di mana pun.
-- ---------------------------------------------------------------------

alter table gaji_telly drop constraint gaji_telly_operasional_rekap_id_fkey;
alter table gaji_telly
  add constraint gaji_telly_operasional_rekap_id_fkey
  foreign key (operasional_rekap_id, entity_id)
  references operasional_rekap (id, entity_id) on delete cascade;


-- ---------------------------------------------------------------------
--  2. Satu truk satu baris per kegiatan.
--
--  Laravel mengandalkannya (keyBy('kendaraan_id') di updateKegiatan) tanpa
--  menjaganya: truk yang tercantum dua kali saling menimpa.
-- ---------------------------------------------------------------------

alter table transaksi_operasional
  add constraint transaksi_satu_truk_per_kegiatan unique (operasional_rekap_id, kendaraan_id);


-- ---------------------------------------------------------------------
--  3. Pembantu
-- ---------------------------------------------------------------------

/** Nama untuk dibandingkan: tanpa beda huruf besar-kecil dan spasi ganda. */
create or replace function nama_banding(p text)
returns text
language sql
immutable
as $$ select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) $$;

/**
 * Tanggal untuk baris truk sebuah kegiatan. Bulan transaksi ditentukan oleh
 * kolom `tanggal` (10-integrasi-operasional.md), jadi harus jatuh di bulan
 * kegiatannya: tanggal kegiatan bila ada di bulan itu, selain itu tanggal 1.
 * Sama dengan $tglStr di OperasionalController::updateKegiatan.
 */
create or replace function tanggal_truk_kegiatan(p_bulan int, p_tahun int, p_tanggal_kegiatan date)
returns date
language sql
immutable
as $$
  select case
    when p_tanggal_kegiatan is not null
     and extract(month from p_tanggal_kegiatan) = p_bulan
     and extract(year from p_tanggal_kegiatan) = p_tahun
    then p_tanggal_kegiatan
    else make_date(p_tahun, p_bulan, 1)
  end
$$;

/**
 * Kapal menurut nama di satu entitas; dibuat bila belum ada.
 *
 * Laravel: Kapal::firstOrCreate(['nama_kapal' => ...]) dengan id dari
 * combobox. PERBAIKAN: hanya nama yang dipakai. Combobox Laravel menyimpan
 * kapal_id pilihan pertama walau namanya kemudian diketik ulang, sehingga
 * kegiatan tercatat pada kapal yang salah.
 */
create or replace function kapal_menurut_nama(p_entity_id uuid, p_nama text)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nama text := regexp_replace(btrim(coalesce(p_nama, '')), '\s+', ' ', 'g');
  v_id bigint;
begin
  if v_nama = '' then
    raise exception 'Nama kapal wajib diisi.';
  end if;

  select id into v_id
    from kapal
   where entity_id = p_entity_id and nama_banding(nama_kapal) = nama_banding(v_nama)
   order by id
   limit 1;

  if v_id is null then
    insert into kapal (entity_id, nama_kapal) values (p_entity_id, v_nama) returning id into v_id;
  end if;
  return v_id;
end;
$$;

/**
 * Iuran paguyuban satu truk: tonase × tarif. Paguyuban::sinkronkan apa
 * adanya — tarif yang sudah tersimpan dipakai lagi, truk tanpa tonase
 * tidak punya iuran.
 */
create or replace function sinkron_paguyuban(p_transaksi_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  t transaksi_operasional;
begin
  select * into t from transaksi_operasional where id = p_transaksi_id;
  if not found then
    return;
  end if;

  if t.tonase <= 0 then
    delete from paguyuban where transaksi_id = t.id;
    return;
  end if;

  insert into paguyuban (entity_id, transaksi_id, tanggal, tarif, total_bayar)
  values (t.entity_id, t.id, t.tanggal, 500, t.tonase * 500)
  on conflict (transaksi_id) do update
     set tanggal = excluded.tanggal,
         total_bayar = t.tonase * paguyuban.tarif;
end;
$$;

/**
 * Jumlah truk ke kegiatan, lalu honor telly per kegiatan.
 *
 * Jumlah: sama dengan updateKegiatan dan updatePembayaranBulk — ritase,
 * tonase, saku, dan terpal dijumlah dari truk. Biaya operasional tidak:
 * angka itu diisi admin di kegiatan dan baris truk selalu 0.
 *
 * Honor telly (syncGajiTelly): gaji per ton = yang sudah tersimpan, atau
 * tarif telly karyawan, atau 400; total = tonase kegiatan × gaji per ton;
 * PPh yang sudah diisi dipertahankan; bersih = total − PPh, minimal 0.
 * PERBAIKAN: bila petugas telly diganti, gaji per ton diambil dari tarif
 * petugas yang baru — Laravel tetap memakai tarif petugas lama.
 */
create or replace function hitung_ulang_kegiatan(p_rekap_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r operasional_rekap;
  g gaji_telly;
  v_tarif numeric;
  v_gaji numeric;
  v_total numeric;
begin
  update operasional_rekap o
     set trips       = s.trips,
         tonase      = s.tonase,
         sangu_supir = s.sangu,
         terpal      = s.terpal
    from (
      select coalesce(sum(ritase), 0)::int     as trips,
             coalesce(sum(tonase), 0)          as tonase,
             coalesce(sum(sangu_supir), 0)     as sangu,
             coalesce(sum(terpal), 0)          as terpal
        from transaksi_operasional
       where operasional_rekap_id = p_rekap_id
    ) s
   where o.id = p_rekap_id
  returning o.* into r;

  if not found then
    raise exception 'Kegiatan tidak ditemukan, atau akun Anda tidak berwenang mengubah data operasional entitas ini.';
  end if;

  if r.telly_id is null then
    delete from gaji_telly where operasional_rekap_id = r.id and transaksi_id is null;
    return;
  end if;

  select case when tarif_telly > 0 then tarif_telly else 400 end
    into v_tarif
    from karyawan where id = r.telly_id;
  v_tarif := coalesce(v_tarif, 400);

  select * into g
    from gaji_telly
   where operasional_rekap_id = r.id and transaksi_id is null
   order by id
   limit 1;

  if found then
    v_gaji := case when g.karyawan_id = r.telly_id and g.gaji > 0 then g.gaji else v_tarif end;
    v_total := coalesce(r.tonase, 0) * v_gaji;
    update gaji_telly
       set karyawan_id = r.telly_id,
           gaji        = v_gaji,
           gaji_total  = v_total,
           gaji_bersih = greatest(0, v_total - pph),
           keterangan  = r.keterangan
     where id = g.id;
  else
    v_total := coalesce(r.tonase, 0) * v_tarif;
    insert into gaji_telly (entity_id, karyawan_id, operasional_rekap_id, gaji, gaji_total, pph, gaji_bersih, keterangan)
    values (r.entity_id, r.telly_id, r.id, v_tarif, v_total, 0, v_total, r.keterangan);
  end if;
end;
$$;


-- ---------------------------------------------------------------------
--  4. Database General — Tambah Data General
--
--  OperasionalController::storeBulk dari modal Database General: kapal
--  dan tanggal saja; rute, truk, dan biaya dilengkapi kemudian.
--
--  PERBAIKAN: selalu kegiatan BARU. Laravel memakai updateOrCreate pada
--  (bulan, tahun, kapal, rute) — menambah kapal yang sama dua kali
--  menimpa kegiatan pertama dengan tonase dan biaya operasional 0.
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
    p_entity_id, p_bulan, p_tahun, v_kapal, 'Kapal/Pelabuhan', 0, 0, 0, 0, 0,
    coalesce(p_tanggal_input, current_date), p_tanggal_kegiatan, p_tanggal_selesai, p_keterangan
  )
  returning id into v_id;

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
--  5. Database General — Ubah Data
--
--  OperasionalController::updateRekapModal: nama kapal, bulan, tanggal.
--
--  PERBAIKAN: truknya ikut. Laravel hanya memindahkan kegiatan; truknya
--  tertinggal di kapal dan bulan lama, sehingga kegiatan di bulan baru
--  kosong dan truknya tidak lagi terlihat di mana pun.
-- ---------------------------------------------------------------------

create or replace function ubah_kegiatan(
  p_rekap_id         bigint,
  p_nama_kapal       text,
  p_bulan            int,
  p_tahun            int,
  p_tanggal_input    date,
  p_tanggal_kegiatan date,
  p_tanggal_selesai  date
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r operasional_rekap;
  v_kapal bigint;
begin
  select * into r from operasional_rekap where id = p_rekap_id for update;
  if not found then
    raise exception 'Kegiatan tidak ditemukan, atau akun Anda tidak berwenang mengubahnya.';
  end if;

  v_kapal := kapal_menurut_nama(r.entity_id, p_nama_kapal);

  update operasional_rekap
     set kapal_id         = v_kapal,
         bulan            = p_bulan,
         tahun            = p_tahun,
         tanggal_input    = coalesce(p_tanggal_input, tanggal_input),
         tanggal_kegiatan = p_tanggal_kegiatan,
         tanggal_selesai  = p_tanggal_selesai
   where id = r.id;
  if not found then
    raise exception 'Akun Anda tidak berwenang mengubah data operasional entitas ini.';
  end if;

  update transaksi_operasional
     set kapal_id         = v_kapal,
         tanggal          = tanggal_truk_kegiatan(p_bulan, p_tahun, p_tanggal_kegiatan),
         tanggal_kegiatan = p_tanggal_kegiatan,
         tanggal_selesai  = p_tanggal_selesai
   where operasional_rekap_id = r.id;

  update paguyuban p
     set tanggal = t.tanggal
    from transaksi_operasional t
   where t.operasional_rekap_id = r.id and p.transaksi_id = t.id;
end;
$$;


-- ---------------------------------------------------------------------
--  6. Lengkapi Data Kegiatan
--
--  OperasionalController::updateKegiatan. p_truk: array
--    { nopol, pemilik_id?, pemilik_baru?, ritase, tonase }
--
--  Rumus apa adanya. PERBAIKAN:
--    - Truk lama TIDAK berganti pemilik. Laravel memindahkan kendaraan ke
--      kelompok pemilik tempat ia dicantumkan, untuk semua kegiatan.
--    - Pemilik baru yang diketik dibuat. Laravel menyimpan pemilik_id
--      kosong dan nama pemiliknya hilang.
--    - Ritase dan tonase 0 tersimpan sebagai 0. Laravel mengabaikan 0 dan
--      mempertahankan angka lama, sehingga tonase tidak bisa dikoreksi ke 0.
--    - Iuran paguyuban dan beban rekanan (tonase × ongkos angkut) ikut
--      dihitung ulang saat tonase berubah. Laravel tidak, sehingga
--      keduanya tertinggal dari tonase sampai Rincian Pembayaran disimpan.
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
         operasional      = coalesce(p_operasional, 0),
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
--  7. Rincian Pembayaran Truk
--
--  LaporanController::updatePembayaranBulk. p_truk: array
--    { id, ritase, tonase, ongkos_angkut, sangu_supir, terpal }
--
--  Rumus apa adanya: beban rekanan (kolom `pendapatan`) = tonase × ongkos
--  angkut; iuran paguyuban disinkronkan; jumlah kegiatan dan honor telly
--  dihitung ulang. PERBAIKAN: dihitung ulang untuk kegiatan truk itu.
--  Laravel mencari kegiatannya lewat (kapal, rute, bulan) — dua kegiatan
--  kapal yang sama pada rute yang sama tercampur jumlahnya.
-- ---------------------------------------------------------------------

create or replace function simpan_pembayaran_truk(p_rekap_id bigint, p_truk jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_id bigint;
  v_tonase numeric;
  v_ongkos numeric;
begin
  perform 1 from operasional_rekap where id = p_rekap_id for update;
  if not found then
    raise exception 'Kegiatan tidak ditemukan, atau akun Anda tidak berwenang mengubahnya.';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_truk, '[]'::jsonb)) loop
    v_id     := (v_item->>'id')::bigint;
    v_tonase := coalesce((v_item->>'tonase')::numeric, 0);
    v_ongkos := coalesce((v_item->>'ongkos_angkut')::numeric, 0);

    update transaksi_operasional
       set ritase        = coalesce((v_item->>'ritase')::int, 0),
           tonase        = v_tonase,
           ongkos_angkut = v_ongkos,
           pendapatan    = v_tonase * v_ongkos,
           sangu_supir   = coalesce((v_item->>'sangu_supir')::numeric, 0),
           terpal        = coalesce((v_item->>'terpal')::numeric, 0)
     where id = v_id and operasional_rekap_id = p_rekap_id;
    if not found then
      raise exception 'Baris truk tidak ditemukan pada kegiatan ini, atau akun Anda tidak berwenang mengubahnya. Muat ulang halaman lalu coba lagi.';
    end if;

    perform sinkron_paguyuban(v_id);
  end loop;

  perform hitung_ulang_kegiatan(p_rekap_id);
end;
$$;


-- ---------------------------------------------------------------------
--  8. Hak eksekusi
-- ---------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'nama_banding(text)',
    'tanggal_truk_kegiatan(int, int, date)',
    'kapal_menurut_nama(uuid, text)',
    'sinkron_paguyuban(bigint)',
    'hitung_ulang_kegiatan(bigint)',
    'tambah_kegiatan(uuid, text, int, int, date, date, date, text)',
    'ubah_kegiatan(bigint, text, int, int, date, date, date)',
    'simpan_rincian_kegiatan(bigint, text, numeric, bigint, date, date, date, text, jsonb)',
    'simpan_pembayaran_truk(bigint, jsonb)'
  ] loop
    execute format('revoke all on function %s from public', f);
    -- 'anon' hanya ada di stack Supabase lokal (Neon tidak punya role itu).
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

comment on function tambah_kegiatan(uuid, text, int, int, date, date, date, text) is
  'Database General → Tambah Data General: satu kegiatan kapal baru. Kapal dicari menurut nama, dibuat bila belum ada.';
comment on function ubah_kegiatan(bigint, text, int, int, date, date, date) is
  'Database General → Ubah Data: kapal, bulan, dan tanggal kegiatan; truknya ikut pindah.';
comment on function simpan_rincian_kegiatan(bigint, text, numeric, bigint, date, date, date, text, jsonb) is
  'Lengkapi Data Kegiatan: rute, biaya operasional, telly, tanggal, dan daftar truk dalam satu transaksi.';
comment on function simpan_pembayaran_truk(bigint, jsonb) is
  'Rincian Pembayaran Truk: ritase, tonase, ongkos angkut, saku, dan terpal per truk; beban rekanan, paguyuban, dan honor telly dihitung ulang.';
