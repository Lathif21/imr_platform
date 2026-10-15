-- =====================================================================
--  RLS dihitung sekali per query, bukan sekali per baris
--
--  Policy operasional berbunyi `using (can_read_operational(entity_id))`.
--  Fungsi SECURITY DEFINER tidak bisa di-inline oleh planner, jadi ia
--  dipanggil untuk SETIAP baris — dan setiap panggilan membaca `profiles`
--  dan `user_entity_access` lagi. Policy `_write` (FOR ALL) ikut berlaku
--  untuk SELECT, jadi satu baris memanggil keduanya. Terukur di stack
--  lokal: `select count(*)` atas 20.000 baris pemilik butuh 9,3 detik.
--
--  Bentuk baru: `entity_id in (select entitas_baca_operasional())`.
--  Subquery-nya tidak berkorelasi dengan baris, jadi Postgres
--  menjalankannya sekali (hashed SubPlan) lalu mencocokkan setiap baris
--  dengan himpunan kecil — paling banyak sebanyak jumlah entitas.
--
--  Semantik tidak berubah. Fungsi-fungsi baru menyaring `entities`
--  dengan fungsi lama yang sama persis (can_read_operational, dst.), jadi
--  aturan aksesnya tetap tinggal di satu tempat. Perbedaan satu-satunya
--  adalah entity_id NULL — fungsi lama meloloskannya untuk direksi, bentuk
--  baru tidak — dan setiap kolom entity_id di bawah ini NOT NULL dengan FK
--  ke entities, sehingga baris seperti itu tidak mungkin ada.
--
--  Fungsi tanpa argumen (can_read_reports() dan kawan-kawan) dibungkus
--  `(select …)` dengan alasan yang sama: tanpa pembungkus ia dievaluasi
--  per baris, dengan pembungkus menjadi InitPlan yang dihitung sekali.
--
--  Tabel operasional baru: pakai bentuk ini, bukan can_read_operational
--  per baris. tests/operasional-rls.test.ts menolak bentuk lama.
-- =====================================================================

create or replace function entitas_baca_operasional()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from entities where can_read_operational(id);
$$;

create or replace function entitas_tulis_operasional()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from entities where can_write_operational(id);
$$;

create or replace function entitas_terakses()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from entities where has_entity_access(id);
$$;

comment on function entitas_baca_operasional() is
  'Entitas yang data operasionalnya boleh dibaca pemanggil. Untuk policy: entity_id in (select entitas_baca_operasional()).';
comment on function entitas_tulis_operasional() is
  'Entitas yang data operasionalnya boleh ditulis pemanggil. Untuk policy: entity_id in (select entitas_tulis_operasional()).';
comment on function entitas_terakses() is
  'Entitas yang boleh diakses pemanggil (has_entity_access). Untuk policy laporan.';

revoke all on function entitas_baca_operasional() from public;
revoke all on function entitas_tulis_operasional() from public;
revoke all on function entitas_terakses() from public;
grant execute on function entitas_baca_operasional() to authenticated;
grant execute on function entitas_tulis_operasional() to authenticated;
grant execute on function entitas_terakses() to authenticated;

-- ---------------------------------------------------------------------
--  Tabel operasional: setiap pasangan <tabel>_select / <tabel>_write
--  yang masih berbentuk lama. Diambil dari katalog, bukan daftar tulisan
--  tangan, supaya tabel yang ditambahkan satu per satu (lampiran_
--  operasional, pajak_partner) tidak tertinggal.
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_policies
     where schemaname = 'public'
       and policyname = tablename || '_select'
       and qual = 'can_read_operational(entity_id)'
  loop
    execute format('drop policy %I on %I', t || '_select', t);
    execute format(
      'create policy %I on %I for select to authenticated
         using (entity_id in (select entitas_baca_operasional()))',
      t || '_select', t);

    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format(
      'create policy %I on %I for all to authenticated
         using (entity_id in (select entitas_tulis_operasional()))
         with check (entity_id in (select entitas_tulis_operasional()))',
      t || '_write', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
--  Laporan laba rugi
-- ---------------------------------------------------------------------

drop policy periods_select on periods;
create policy periods_select on periods for select to authenticated
  using (entity_id in (select entitas_terakses()) and (select can_read_reports()));

drop policy periods_insert on periods;
create policy periods_insert on periods for insert to authenticated
  with check (entity_id in (select entitas_terakses()) and (select can_write_reports()));

drop policy periods_update on periods;
create policy periods_update on periods for update to authenticated
  using (entity_id in (select entitas_terakses()) and (select can_write_reports()))
  with check (entity_id in (select entitas_terakses()) and (select can_write_reports()));

-- Subquery ke periods tetap tunduk pada RLS periods, persis seperti EXISTS
-- yang digantikannya.
drop policy lines_select on report_lines;
create policy lines_select on report_lines for select to authenticated
  using (
    (select can_read_reports())
    and period_id in (select p.id from periods p where p.entity_id in (select entitas_terakses()))
  );

drop policy lines_write on report_lines;
create policy lines_write on report_lines for all to authenticated
  using (
    (select can_write_reports())
    and period_id in (
      select p.id from periods p
       where p.status = 'draft' and p.entity_id in (select entitas_terakses())
    )
  )
  with check (
    (select can_write_reports())
    and period_id in (
      select p.id from periods p
       where p.status = 'draft' and p.entity_id in (select entitas_terakses())
    )
  );

drop policy lampiran_periode_select on lampiran_periode;
create policy lampiran_periode_select on lampiran_periode for select to authenticated
  using (entity_id in (select entitas_terakses()) and (select can_read_reports()));

drop policy lampiran_periode_insert on lampiran_periode;
create policy lampiran_periode_insert on lampiran_periode for insert to authenticated
  with check (entity_id in (select entitas_terakses()) and (select can_write_reports()));

drop policy lampiran_periode_delete on lampiran_periode;
create policy lampiran_periode_delete on lampiran_periode for delete to authenticated
  using (
    entity_id in (select entitas_terakses())
    and (select can_write_reports())
    and period_id in (select p.id from periods p where p.status in ('draft', 'submitted'))
  );

-- ---------------------------------------------------------------------
--  Penjaga: tidak boleh tersisa policy yang memanggil fungsi akses per
--  baris pada tabel-tabel di atas.
-- ---------------------------------------------------------------------

do $$
declare
  sisa text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into sisa
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(can_read_operational|can_write_operational)\(entity_id\)';
  if sisa is not null then
    raise exception 'Policy masih berbentuk per baris: %', sisa;
  end if;
end;
$$;
