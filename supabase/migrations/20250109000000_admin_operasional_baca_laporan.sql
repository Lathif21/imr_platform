-- =====================================================================
--  ADMIN OPERASIONAL MEMBACA LAPORAN LABA RUGI
--
--  Keputusan 7 Oktober 2026 (docs/PENGGABUNGAN.md, Q-1): admin_operasional
--  boleh MEMBACA laporan laba rugi entitas yang ditugaskan kepadanya —
--  angka yang sebagian besar berasal dari data yang ia input sendiri.
--
--  Hanya membaca. can_write_reports() tidak disentuh: admin operasional
--  tetap tidak dapat membuat periode, mengubah baris laporan, atau
--  mengajukannya. Cakupan entitas tetap has_entity_access(), jadi ia
--  hanya melihat P&L entitas yang ditautkan di user_entity_access.
--
--  Policy tidak perlu diubah: periods_select dan lines_select sudah
--  memanggil fungsi ini, dan view laporan memakai security_invoker.
-- =====================================================================

create or replace function can_read_reports()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    current_user_role() in (
      'direksi', 'manajer_keuangan', 'staf_entitas', 'auditor', 'admin_operasional'
    ),
    false
  );
$$;

comment on function can_read_reports() is
  'Peran yang boleh membaca periode dan baris laporan laba rugi, termasuk '
  'admin_operasional (baca saja). Cakupan entitas tetap has_entity_access().';
