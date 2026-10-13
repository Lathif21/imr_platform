-- =====================================================================
--  Laporan per Kapal
--
--  Laporan "Rincian Kegiatan Operasional" per kapal per bulan (format
--  KM SANEI.pdf / TS 28.pdf dari pengguna, 13 Oktober 2026) memuat dua
--  hal yang belum tersimpan di mana pun:
--
--    1. Voyage di judul ("KM. SANEI VOY. 9").
--       kapal.voyage ada sejak 20250108 tetapi tidak dipakai, dan memang
--       tidak bisa: satu baris kapal dipakai untuk setiap kedatangan kapal
--       itu (nama dicari tanpa beda huruf/spasi, 20250113), sedangkan
--       voyage berganti setiap kedatangan. Menyimpannya di kapal berarti
--       laporan bulan lalu ikut tercetak dengan voyage bulan ini.
--       Disimpan per kegiatan; layar Laporan per Kapal mengisinya untuk
--       semua kegiatan kapal itu di bulan itu sekaligus.
--
--    2. Rekening pembayaran rekanan (atas nama, nomor, bank) di tabel
--       penutup laporan. Opsional — contoh pengguna pun punya rekanan
--       tanpa rekening.
--
--  Hanya kolom baru di tabel yang sudah ada: RLS, audit, dan updated_at
--  tetap dari loop 20250108. Data API Neon perlu "Refresh schema cache"
--  setelah migrasi ini diterapkan.
-- =====================================================================

alter table operasional_rekap add column voyage text;

comment on column operasional_rekap.voyage is
  'Voyage kapal untuk kegiatan ini, mis. "9". Judul Laporan per Kapal. Bukan kapal.voyage (kapal dipakai ulang lintas kedatangan).';

alter table pemilik
  add column rekening_atas_nama text,
  add column no_rekening        text,
  add column nama_bank          text;

comment on column pemilik.rekening_atas_nama is 'Nama pemilik rekening pembayaran rekanan. Kosong = belum diisi.';
comment on column pemilik.no_rekening is 'Nomor rekening pembayaran rekanan, teks apa adanya (spasi dipertahankan).';
comment on column pemilik.nama_bank is 'Bank rekening pembayaran rekanan, mis. BCA.';
