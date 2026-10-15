-- =====================================================================
--  Hapus data UJI COBA operasional — dicatat 15 Oktober 2026.
--
--  Dijalankan di VPS uji, dan sekali lagi saat cutover SETELAH
--  `pindah` menyalin ulang dari Neon (deploy/README.md bagian 4b):
--
--    docker compose exec -T db psql -U postgres -d imr -v ON_ERROR_STOP=1 < sql/bersihkan-data-uji.sql
--
--  Berdasarkan ID, bukan "hapus semua": data asli yang diinput di portal
--  lama sebelum cutover tidak tersentuh. ID yang sudah tidak ada dilewati,
--  jadi aman diulang.
--
--  Ikut terhapus lewat FK CASCADE: rincian truk (transaksi_operasional),
--  paguyuban, gaji telly, catatan karyawan, lampiran. Trigger sistem
--  menghitung ulang P&L draft yang berasal dari data ini.
--
--  audit_log mencatat setiap baris dengan actor_id NULL: penghapusan oleh
--  admin sistem, bukan oleh salah satu pengguna.
-- =====================================================================

begin;

-- Kegiatan kapal: KM Sinar Jaya (ILA Mei & Okt), KM SANEI VOY 9 (ILJ Sep),
-- KM CLARISA VOY 3 (ILA Sep), KM. TIRTA SAMUDRA XXVIII Voy. 13 (ILJ Agu/Sep).
delete from operasional_rekap where id in (38, 39, 40, 41, 42, 44);

-- Laporan Pendapatan dari kegiatan di atas.
delete from laporan_pendapatan where id in (39, 40, 41, 42, 43, 45);

-- Pencairan 009/PT.ILA-IX/2026 dan 1/PT.ILA-IX/2026 (+ persetujuannya).
delete from pencairan where id in (20, 21);

-- Karyawan "Budi" (Telly) beserta gaji telly dan catatannya.
delete from karyawan where id in (43);

select 'sisa ' || t || ': ' || n as hasil
  from (values
    ('kegiatan kapal',     (select count(*) from operasional_rekap)),
    ('rincian truk',       (select count(*) from transaksi_operasional)),
    ('paguyuban',          (select count(*) from paguyuban)),
    ('laporan pendapatan', (select count(*) from laporan_pendapatan)),
    ('pencairan',          (select count(*) from pencairan)),
    ('karyawan',           (select count(*) from karyawan)),
    ('gaji telly',         (select count(*) from gaji_telly))
  ) as s(t, n);

commit;
