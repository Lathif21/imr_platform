-- =====================================================================
--  HAPUS KAPAL (Fase 1b)
--
--  Laravel (KapalController::destroy) menghapus kapal beserta seluruh
--  kegiatannya dalam satu transaksi: honor telly per rekap, transaksi,
--  rekap, rute, dan rincian muatan. Di skema ini sebagian besar ikut
--  lewat FK ON DELETE CASCADE, kecuali dua hal yang harus ditangani di
--  sini:
--
--    1. gaji_telly.operasional_rekap_id ON DELETE SET NULL. Tanpa langkah
--       eksplisit, honor telly per kegiatan tidak terhapus melainkan
--       kehilangan induknya — dan baris gaji_telly tanpa transaksi_id
--       maupun operasional_rekap_id dibaca sebagai GAJI ADMIN. Laravel
--       menghapusnya; begitu juga di sini.
--
--    2. pencairan.kapal_id ON DELETE CASCADE. Menghapus kapal akan ikut
--       menghapus pencairan dan riwayat approval-nya tanpa sepatah kata.
--       Laravel tidak pernah melakukan itu. Kapal yang punya pencairan
--       DITOLAK; pencairannya diselesaikan dulu.
--
--  security invoker: RLS pemanggil tetap berlaku (hanya admin_operasional
--  yang ditugaskan ke entitas itu yang bisa menulis), dan trigger audit
--  mencatat setiap baris yang terhapus, termasuk lewat cascade.
-- =====================================================================

create or replace function hapus_kapal(p_kapal_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nama text;
  v_pencairan int;
begin
  select nama_kapal into v_nama from kapal where id = p_kapal_id;
  if not found then
    raise exception 'Data kapal tidak ditemukan, atau Anda tidak berwenang menghapusnya.';
  end if;

  select count(*) into v_pencairan from pencairan where kapal_id = p_kapal_id;
  if v_pencairan > 0 then
    raise exception 'Kapal % tidak bisa dihapus karena masih punya % pencairan. Selesaikan atau hapus pencairannya lebih dulu.',
      v_nama, v_pencairan;
  end if;

  delete from gaji_telly
   where operasional_rekap_id in (select id from operasional_rekap where kapal_id = p_kapal_id);

  delete from kapal where id = p_kapal_id;
  if not found then
    raise exception 'Kapal % gagal dihapus: akun Anda tidak berwenang mengubah data operasional entitas ini.', v_nama;
  end if;
end;
$$;

comment on function hapus_kapal(bigint) is
  'Hapus kapal beserta kegiatan, transaksi, rute, muatan, dan honor telly per kegiatannya dalam satu transaksi. Ditolak bila kapal punya pencairan.';

revoke all on function hapus_kapal(bigint) from public;

--  'anon' hanya ada di stack Supabase lokal (Neon tidak punya role itu),
--  dan di sana default privileges memberinya EXECUTE pada fungsi baru.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function hapus_kapal(bigint) from anon;
  end if;
end;
$$;

grant execute on function hapus_kapal(bigint) to authenticated;
