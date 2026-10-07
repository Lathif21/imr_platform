-- =====================================================================
--  PERAN admin_operasional
--
--  Platform terpadu: sistem operasional ILJ (dulu Laravel,
--  LaporanKeuangan) pindah ke portal ini. Admin operasional menginput
--  kapal, transaksi, rekap, pencairan, dan laporan operasional entitas
--  yang ditugaskan kepadanya lewat user_entity_access, persis seperti
--  staf_entitas ditugaskan.
--
--  Peran `hrd` di Laravel TIDAK dibuat. Keputusan 7 Oktober 2026: untuk
--  saat ini akun HRD memakai peran direksi. Lihat docs/PENGGABUNGAN.md.
--
--  Berkas sendiri, terpisah dari tabel operasional: nilai enum yang baru
--  ditambahkan tidak boleh dipakai di transaksi yang sama, dan setiap
--  berkas migrasi berjalan dalam satu transaksi. Fungsi dan policy yang
--  menyebut 'admin_operasional' ada di migrasi berikutnya.
-- =====================================================================

alter type user_role add value if not exists 'admin_operasional';
