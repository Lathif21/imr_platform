-- =====================================================================
--  LAPORAN GAJI (Fase 4b)
--
--  LaporanController::updateGajiTelly dan barisAdminBaru (Laravel PR #5).
--  Laporan Gaji di Laravel juga MENULIS saat dibuka: ia menyinkronkan
--  baris honor telly setiap kegiatan dan menimpa tonase kegiatan. Di sini
--  baris honor telly sudah dijaga hitung_ulang_kegiatan() (20250113) setiap
--  kegiatan disimpan, sehingga laporan cukup membaca. Yang tersisa adalah
--  dua aksi simpan.
--
--  Bulan baris gaji admin = created_at menurut jam Jakarta. Laravel
--  menyimpan jam lokal tanpa zona; skrip migrasi data menyalinnya sebagai
--  Asia/Jakarta, dan baris baru di sini dibuat pukul 10:00 WIB tanggal 1.
-- =====================================================================

/**
 * Honor telly per kegiatan: gaji per ton, PPh, keterangan. Total = tonase
 * kegiatan × gaji per ton; bersih = total − PPh, minimal 0.
 *
 * PERBAIKAN: tonase tidak bisa diubah dari sini. Laravel menimpa tonase
 * kegiatan dari form gaji, padahal tonase adalah jumlah truknya — angka itu
 * kembali ke jumlah truk pada simpan kegiatan berikutnya, dan sebelum itu
 * laporan lain membaca tonase yang tidak cocok dengan truknya.
 */
create or replace function simpan_gaji_telly(p_id bigint, p_gaji numeric, p_pph numeric, p_keterangan text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  g gaji_telly;
  v_tonase numeric;
  v_total numeric;
begin
  select * into g from gaji_telly where id = p_id for update;
  if not found then
    raise exception 'Baris gaji tidak ditemukan, atau akun Anda tidak berwenang mengubahnya.';
  end if;

  if g.operasional_rekap_id is not null then
    select tonase into v_tonase from operasional_rekap where id = g.operasional_rekap_id;
  elsif g.transaksi_id is not null then
    select tonase into v_tonase from transaksi_operasional where id = g.transaksi_id;
  else
    raise exception 'Baris ini gaji admin bulanan; simpan lewat formulir gaji admin.';
  end if;

  v_total := coalesce(v_tonase, 0) * coalesce(p_gaji, 0);
  update gaji_telly
     set gaji        = coalesce(p_gaji, 0),
         gaji_total  = v_total,
         pph         = coalesce(p_pph, 0),
         gaji_bersih = greatest(0, v_total - coalesce(p_pph, 0)),
         keterangan  = p_keterangan
   where id = g.id;
  if not found then
    raise exception 'Akun Anda tidak berwenang mengubah data operasional entitas ini.';
  end if;
end;
$$;

/**
 * Gaji admin bulanan — satu baris per karyawan per bulan (PR #5). Dibuat
 * saat pertama disimpan, tidak saat halaman dibuka. Hanya untuk karyawan
 * berjabatan admin, seperti barisAdminBaru().
 */
create or replace function simpan_gaji_admin(
  p_entity_id   uuid,
  p_karyawan_id bigint,
  p_bulan       int,
  p_tahun       int,
  p_gaji_total  numeric,
  p_pph         numeric,
  p_keterangan  text
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_jabatan text;
  v_id bigint;
begin
  select jabatan into v_jabatan from karyawan where id = p_karyawan_id and entity_id = p_entity_id;
  if not found then
    raise exception 'Karyawan tidak ditemukan di entitas ini.';
  end if;
  if coalesce(v_jabatan, '') !~* 'admin' then
    raise exception 'Gaji bulanan hanya dapat dicatat untuk karyawan berjabatan admin. Honor telly dihitung dari kegiatan kapal.';
  end if;

  select id into v_id
    from gaji_telly
   where karyawan_id = p_karyawan_id
     and operasional_rekap_id is null and transaksi_id is null
     and extract(month from created_at at time zone 'Asia/Jakarta') = p_bulan
     and extract(year from created_at at time zone 'Asia/Jakarta') = p_tahun
   order by id
   limit 1
   for update;

  if v_id is null then
    insert into gaji_telly (entity_id, karyawan_id, gaji, gaji_total, pph, gaji_bersih, keterangan, created_at)
    values (
      p_entity_id, p_karyawan_id, 0, coalesce(p_gaji_total, 0), coalesce(p_pph, 0),
      greatest(0, coalesce(p_gaji_total, 0) - coalesce(p_pph, 0)),
      coalesce(nullif(btrim(p_keterangan), ''), 'Gaji Admin Bulanan'),
      make_timestamptz(p_tahun, p_bulan, 1, 10, 0, 0, 'Asia/Jakarta')
    )
    returning id into v_id;
    return v_id;
  end if;

  update gaji_telly
     set gaji_total  = coalesce(p_gaji_total, 0),
         pph         = coalesce(p_pph, 0),
         gaji_bersih = greatest(0, coalesce(p_gaji_total, 0) - coalesce(p_pph, 0)),
         keterangan  = coalesce(nullif(btrim(p_keterangan), ''), keterangan)
   where id = v_id;
  if not found then
    raise exception 'Akun Anda tidak berwenang mengubah data operasional entitas ini.';
  end if;
  return v_id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'simpan_gaji_telly(bigint, numeric, numeric, text)',
    'simpan_gaji_admin(uuid, bigint, int, int, numeric, numeric, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
