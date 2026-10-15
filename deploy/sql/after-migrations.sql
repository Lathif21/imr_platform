-- =====================================================================
--  Dijalankan scripts/migrate.ts SETELAH supabase/migrations. Aman diulang.
-- =====================================================================

-- imr_auth membaca peran dan nama untuk sesi (hooks.server.ts) dan
-- memastikan pemanggil admin akun adalah direksi aktif. Hanya empat kolom
-- itu; tidak ada hak tulis apa pun di public.
grant usage on schema public to imr_auth;
grant select (id, role, full_name, is_active) on public.profiles to imr_auth;

-- profiles ber-RLS dan setiap policy-nya `to authenticated`; tanpa ini
-- imr_auth melihat nol baris. Sengaja di sini, bukan di supabase/migrations:
-- role ini hanya ada di VPS. Hak tulis tetap tidak ada.
drop policy if exists profiles_imr_auth on public.profiles;
create policy profiles_imr_auth on public.profiles for select to imr_auth using (true);

-- PostgREST membaca ulang cache skemanya: fungsi dan tabel baru langsung
-- terlihat tanpa me-restart container.
notify pgrst, 'reload schema';
