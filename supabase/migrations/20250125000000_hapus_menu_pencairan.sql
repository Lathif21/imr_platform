-- =====================================================================
--  Menu Pencairan dihapus
--
--  Status invoice sudah dicatat di Laporan Pendapatan, jadi menu
--  Pencairan (invoice per kapal + persetujuan Jetty, Gudang, Accounting)
--  tidak dipakai lagi. Tabel pencairan dan pencairan_approval beserta
--  datanya TETAP ada; hanya layarnya yang hilang.
--
--  Satu akibat yang harus ditangani: hapus_kapal() (20250112) menolak
--  kapal yang masih punya pencairan dan meminta pencairannya diselesaikan
--  dulu — tanpa menu, itu jalan buntu. Sekarang kapal tetap bisa dihapus;
--  pencairan lamanya ikut terhapus lewat FK CASCADE (dicatat trigger
--  audit), dan layar Data Kapal menyebutkannya di dialog konfirmasi.
-- =====================================================================

create or replace function hapus_kapal(p_kapal_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nama text;
begin
  select nama_kapal into v_nama from kapal where id = p_kapal_id;
  if not found then
    raise exception 'Data kapal tidak ditemukan, atau Anda tidak berwenang menghapusnya.';
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
  'Hapus kapal beserta kegiatan, transaksi, rute, muatan, honor telly per kegiatan, dan pencairan lamanya dalam satu transaksi.';
