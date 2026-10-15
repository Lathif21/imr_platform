-- =====================================================================
--  Peran staf_entitas dan auditor dihapus (keputusan 15 Oktober 2026)
--
--  Admin Operasional sudah mencakup seluruh input, dan hasilnya otomatis
--  menjadi laporan laba rugi (20250121). Peran yang tersisa:
--
--    direksi            semua entitas; menyetujui, mengunci, membuka kunci;
--                       mengelola entitas, template, pengguna
--    manajer_keuangan   entitas yang ditugaskan; menyetujui dan mengunci
--    admin_operasional  entitas yang ditugaskan; input operasional, DAN
--                       mengisi serta mengajukan laporan P&L — tugas yang
--                       dulu milik staf_entitas
--
--  Pemisahan tugas tidak berubah: guard_period_transition() melarang
--  pengaju menyetujui laporannya sendiri, dan menyetujui tetap hanya
--  can_approve() (direksi, manajer_keuangan). Admin Operasional mengajukan,
--  orang lain yang menyetujui.
--
--  Nilai enum tidak dibuang: Postgres tidak bisa menghapus nilai enum tanpa
--  membangun ulang tipe yang dipakai current_user_role() dan audit_log
--  menyimpan nilai lama di riwayatnya. Sebagai gantinya kedua nilai tidak
--  lagi memberi hak apa pun, dan profil baru tidak bisa memakainya.
-- =====================================================================

create or replace function can_write_reports()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() in ('direksi', 'manajer_keuangan', 'admin_operasional'), false);
$$;

comment on function can_write_reports() is
  'Membuat periode, menulis baris laporan, menambah lampiran: direksi, manajer_keuangan, admin_operasional. Cakupan entitas tetap has_entity_access().';

create or replace function can_read_reports()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() in ('direksi', 'manajer_keuangan', 'admin_operasional'), false);
$$;

create or replace function can_read_group_data()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() in ('direksi', 'manajer_keuangan'), false);
$$;

create or replace function can_read_operational(target_entity uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() in ('direksi', 'admin_operasional', 'manajer_keuangan'), false)
     and has_entity_access(target_entity);
$$;

-- Tidak ada lagi peran baca-saja. Profil tanpa peran (nonaktif, atau tanpa
-- sesi) tetap dianggap baca-saja, seperti sebelumnya.
create or replace function is_readonly_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_user_role() is null;
$$;

-- NOT VALID: berlaku untuk setiap INSERT/UPDATE mulai sekarang, tanpa
-- menolak migrasi di database yang masih menyimpan akun lama. Akun seperti
-- itu sudah tidak mendapat hak apa pun dari fungsi-fungsi di atas.
alter table profiles
  add constraint profiles_peran_berlaku
  check (role not in ('staf_entitas', 'auditor')) not valid;

comment on constraint profiles_peran_berlaku on profiles is
  'staf_entitas dan auditor dihapus 15 Okt 2026 (20250130). Nilainya tetap di enum untuk riwayat audit_log.';
