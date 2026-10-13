-- =====================================================================
--  Impor Excel (diputuskan 13 Oktober 2026): template baku diunggah,
--  dipratinjau, lalu disimpan SEMUA ATAU TIDAK SAMA SEKALI.
--
--  Satu fungsi per jenis data. Setiap fungsi berjalan dalam satu transaksi:
--  satu baris yang ditolak membatalkan seluruh impor, jadi tidak pernah ada
--  data setengah masuk. Aplikasi sudah memeriksa setiap baris sebelum
--  memanggil fungsi ini; pemeriksaan di sini adalah jaring pengaman, dan
--  RLS tetap berlaku (security invoker).
--
--  Duplikat dipilih pengguna di pratinjau: "data lama" = baris tidak dikirim,
--  "data baru" = baris dikirim dengan `timpa_id` (id data lama yang ditimpa).
--
--  Kegiatan memakai fungsi yang sama dengan layar (tambah_kegiatan,
--  ubah_kegiatan, simpan_rincian_kegiatan, simpan_pembayaran_truk), jadi
--  aturan kapal, truk, pemilik baru, beban rekanan, paguyuban, dan honor
--  telly identik dengan input manual.
-- =====================================================================

create or replace function impor_wajib_boleh_tulis(p_entity_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not can_write_operational(p_entity_id) then
    raise exception 'Akun Anda tidak berwenang menambah data operasional entitas ini.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
--  Pengeluaran
-- ---------------------------------------------------------------------
create or replace function impor_pengeluaran(p_entity_id uuid, p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  v_n int := 0;
begin
  perform impor_wajib_boleh_tulis(p_entity_id);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if nullif(r->>'timpa_id', '') is not null then
      update pengeluaran
         set tanggal = (r->>'tanggal')::date,
             jenis = btrim(r->>'jenis'),
             nama_kegiatan = nullif(btrim(r->>'nama_kegiatan'), ''),
             penerima = nullif(btrim(r->>'penerima'), ''),
             keterangan = nullif(btrim(r->>'keterangan'), ''),
             jumlah = (r->>'jumlah')::numeric
       where id = (r->>'timpa_id')::bigint and entity_id = p_entity_id;
      if not found then
        raise exception 'Baris %: pengeluaran yang akan ditimpa tidak ditemukan.', r->>'baris';
      end if;
    else
      insert into pengeluaran (entity_id, tanggal, jenis, nama_kegiatan, penerima, keterangan, jumlah)
      values (p_entity_id, (r->>'tanggal')::date, btrim(r->>'jenis'), nullif(btrim(r->>'nama_kegiatan'), ''),
              nullif(btrim(r->>'penerima'), ''), nullif(btrim(r->>'keterangan'), ''), (r->>'jumlah')::numeric);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
--  Data master
-- ---------------------------------------------------------------------

/** Pemilik by name (nama_banding), created when new. */
create or replace function impor_pemilik_menurut_nama(p_entity_id uuid, p_nama text)
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
    raise exception 'Nama pemilik wajib diisi.';
  end if;
  select id into v_id from pemilik
   where entity_id = p_entity_id and nama_banding(nama_pemilik) = nama_banding(v_nama)
   order by id limit 1;
  if v_id is null then
    insert into pemilik (entity_id, nama_pemilik) values (p_entity_id, v_nama) returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function impor_pemilik(p_entity_id uuid, p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  v_n int := 0;
begin
  perform impor_wajib_boleh_tulis(p_entity_id);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    perform impor_pemilik_menurut_nama(p_entity_id, r->>'nama_pemilik');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function impor_kendaraan(p_entity_id uuid, p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  v_pemilik bigint;
  v_n int := 0;
begin
  perform impor_wajib_boleh_tulis(p_entity_id);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_pemilik := impor_pemilik_menurut_nama(p_entity_id, r->>'pemilik');
    if nullif(r->>'timpa_id', '') is not null then
      update kendaraan
         set pemilik_id = v_pemilik, npwp = nullif(btrim(r->>'npwp'), '')
       where id = (r->>'timpa_id')::bigint and entity_id = p_entity_id;
      if not found then
        raise exception 'Baris %: kendaraan yang akan ditimpa tidak ditemukan.', r->>'baris';
      end if;
    else
      insert into kendaraan (entity_id, nopol, pemilik_id, npwp)
      values (p_entity_id, upper(regexp_replace(btrim(r->>'nopol'), '\s+', ' ', 'g')), v_pemilik, nullif(btrim(r->>'npwp'), ''));
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function impor_kapal(p_entity_id uuid, p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  v_n int := 0;
begin
  perform impor_wajib_boleh_tulis(p_entity_id);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if nullif(r->>'timpa_id', '') is not null then
      update kapal set pemilik_kapal = nullif(btrim(r->>'pemilik_kapal'), '')
       where id = (r->>'timpa_id')::bigint and entity_id = p_entity_id;
      if not found then
        raise exception 'Baris %: kapal yang akan ditimpa tidak ditemukan.', r->>'baris';
      end if;
    else
      insert into kapal (entity_id, nama_kapal, pemilik_kapal)
      values (p_entity_id, regexp_replace(btrim(r->>'nama_kapal'), '\s+', ' ', 'g'), nullif(btrim(r->>'pemilik_kapal'), ''));
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function impor_karyawan(p_entity_id uuid, p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  v_n int := 0;
begin
  perform impor_wajib_boleh_tulis(p_entity_id);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if nullif(r->>'timpa_id', '') is not null then
      update karyawan
         set jabatan = nullif(btrim(r->>'jabatan'), ''),
             no_hp = nullif(btrim(r->>'no_hp'), ''),
             tanggal_bergabung = nullif(r->>'tanggal_bergabung', '')::date,
             ktp = nullif(btrim(r->>'ktp'), ''),
             npwp = nullif(btrim(r->>'npwp'), ''),
             alamat = nullif(btrim(r->>'alamat'), ''),
             status = coalesce(nullif(r->>'status', ''), status)
       where id = (r->>'timpa_id')::bigint and entity_id = p_entity_id;
      if not found then
        raise exception 'Baris %: karyawan yang akan ditimpa tidak ditemukan.', r->>'baris';
      end if;
    else
      insert into karyawan (entity_id, nama, jabatan, no_hp, tanggal_bergabung, ktp, npwp, alamat, status)
      values (p_entity_id, btrim(r->>'nama'), nullif(btrim(r->>'jabatan'), ''), nullif(btrim(r->>'no_hp'), ''),
              nullif(r->>'tanggal_bergabung', '')::date, nullif(btrim(r->>'ktp'), ''), nullif(btrim(r->>'npwp'), ''),
              nullif(btrim(r->>'alamat'), ''), coalesce(nullif(r->>'status', ''), 'aktif'));
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
--  Pendapatan (baris manual) — lewat tambah_pendapatan / simpan_pendapatan_massal
-- ---------------------------------------------------------------------
create or replace function impor_pendapatan(p_entity_id uuid, p_bulan int, p_tahun int, p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  v_n int := 0;
begin
  perform impor_wajib_boleh_tulis(p_entity_id);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if nullif(r->>'timpa_id', '') is not null then
      perform 1 from laporan_pendapatan where id = (r->>'timpa_id')::bigint and entity_id = p_entity_id;
      if not found then
        raise exception 'Baris %: invoice yang akan ditimpa tidak ditemukan.', r->>'baris';
      end if;
      perform simpan_pendapatan_massal(jsonb_build_array(r || jsonb_build_object('id', (r->>'timpa_id')::bigint)));
    else
      perform tambah_pendapatan(p_entity_id, p_bulan, p_tahun, r);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
--  Kegiatan kapal & truk — satu elemen per kegiatan, berisi daftar truknya
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
      v_id, nullif(btrim(k->>'rute'), ''), coalesce(nullif(k->>'operasional', '')::numeric, 0),
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'impor_wajib_boleh_tulis(uuid)',
    'impor_pengeluaran(uuid, jsonb)',
    'impor_pemilik_menurut_nama(uuid, text)',
    'impor_pemilik(uuid, jsonb)',
    'impor_kendaraan(uuid, jsonb)',
    'impor_kapal(uuid, jsonb)',
    'impor_karyawan(uuid, jsonb)',
    'impor_pendapatan(uuid, int, int, jsonb)',
    'impor_kegiatan(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
