-- =====================================================================
--  RINGKASAN MASTER DATA OPERASIONAL (Fase 1)
--
--  Angka yang di Laravel dihitung Eloquent di controller (withCount,
--  withSum, accessor status_kinerja) dipindah ke view, supaya layar
--  daftar dan pengaman hapus membaca sumber yang sama.
--
--  security_invoker = on, seperti seluruh view laporan: view menyempit
--  mengikuti RLS pemanggil, sehingga tidak menjadi jalan pintas melewati
--  policy tabel di bawahnya.
-- =====================================================================


-- Pemilik kendaraan (rekanan).
--
-- total_pendapatan_rekanan = sum(transaksi_operasional.pendapatan) lewat
-- kendaraannya — Laravel: withSum('transaksiOperasional', 'pendapatan'),
-- dilabeli "Pendapatan Bruto". Itu pendapatan dari sudut pandang
-- rekanan, yaitu uang yang entitas BAYARKAN ke pemilik truk; lihat
-- docs/task/10-integrasi-operasional.md.
create view v_pemilik_ringkasan
with (security_invoker = on) as
select
  p.id,
  p.entity_id,
  p.nama_pemilik,
  p.created_at,
  (select count(*) from kendaraan k where k.pemilik_id = p.id)::int as jumlah_kendaraan,
  coalesce((
    select sum(t.pendapatan)
    from transaksi_operasional t
    join kendaraan k on k.id = t.kendaraan_id
    where k.pemilik_id = p.id
  ), 0)::numeric(18,2) as total_pendapatan_rekanan
from pemilik p;


-- Kendaraan, dengan pemakaiannya.
--
-- jumlah_muatan dihitung karena kapal_muatan_detail.kendaraan_id adalah
-- ON DELETE CASCADE: menghapus kendaraan yang masih punya rincian muatan
-- akan menghapus rincian itu diam-diam. Laravel hanya menolak bila ada
-- transaksi; layar ini menolak bila ada salah satunya.
create view v_kendaraan_ringkasan
with (security_invoker = on) as
select
  k.id,
  k.entity_id,
  k.nopol,
  k.pemilik_id,
  p.nama_pemilik,
  k.npwp,
  k.created_at,
  (select count(*) from transaksi_operasional t where t.kendaraan_id = k.id)::int as jumlah_transaksi,
  (select count(*) from kapal_muatan_detail m where m.kendaraan_id = k.id)::int as jumlah_muatan
from kendaraan k
join pemilik p on p.id = k.pemilik_id;


-- Karyawan, dengan pemakaian dan status kinerja.
--
-- status_kinerja meniru accessor Karyawan::getStatusKinerjaAttribute:
-- SP terberat yang PERNAH tercatat (SP3 > SP2 > SP1), selain itu 'Normal'.
-- Tidak ada masa berlaku SP di Laravel, jadi di sini pun tidak.
create view v_karyawan_ringkasan
with (security_invoker = on) as
select
  k.id,
  k.entity_id,
  k.nama,
  k.no_hp,
  k.alamat,
  k.tanggal_bergabung,
  k.status,
  k.jabatan,
  k.ktp,
  k.npwp,
  k.created_at,
  case
    when exists (select 1 from karyawan_catatan c where c.karyawan_id = k.id and c.jenis = 'SP3') then 'SP3'
    when exists (select 1 from karyawan_catatan c where c.karyawan_id = k.id and c.jenis = 'SP2') then 'SP2'
    when exists (select 1 from karyawan_catatan c where c.karyawan_id = k.id and c.jenis = 'SP1') then 'SP1'
    else 'Normal'
  end as status_kinerja,
  (select count(*) from transaksi_operasional t where t.telly_id = k.id)::int as jumlah_transaksi_telly,
  (select count(*) from gaji_telly g where g.karyawan_id = k.id)::int as jumlah_gaji_telly
from karyawan k;

comment on view v_karyawan_ringkasan is
  'tarif_telly dan pph_persen sengaja tidak ada: revisi Laravel 1.2 menyembunyikan tarif gaji dari halaman karyawan.';

grant select on v_pemilik_ringkasan, v_kendaraan_ringkasan, v_karyawan_ringkasan to authenticated;
