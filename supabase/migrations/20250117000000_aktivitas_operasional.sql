-- =====================================================================
--  NOTIFIKASI KOLABORASI (Fase 5)
--
--  Laravel: layouts/app.blade.php memanggil latestActivity setiap 5 detik
--  dan menampilkan perubahan oleh pengguna LAIN sebagai toast, dari tabel
--  activity_logs. Di sini sumbernya audit_log (invarian 4; activity_logs
--  sengaja tidak dibuat, lihat 20250108).
--
--  audit_log hanya boleh dibaca direksi dan auditor (20250104), dan isinya
--  memuat nilai lama/baru lengkap. Fungsi ini security definer tetapi
--  hanya mengembalikan RINGKASAN: siapa, kapan, aksi apa, pada data apa —
--  untuk entitas yang boleh dibaca pemanggil (can_read_operational), tanpa
--  aksi pemanggil sendiri, dan hanya 24 jam terakhir.
--
--  Satu simpanan menulis banyak baris (Lengkapi Data: kegiatan, truk,
--  iuran, honor telly, pendapatan). Semua baris satu transaksi punya
--  occurred_at yang sama (now() = awal transaksi), jadi dikelompokkan per
--  (pelaku, occurred_at) menjadi satu notifikasi, diberi nama menurut tabel
--  yang paling mewakili.
-- =====================================================================

create or replace function aktivitas_operasional(p_entity_id uuid, p_setelah bigint)
returns table (
  id       bigint,
  waktu    timestamptz,
  pelaku   text,
  aksi     text,
  tabel    text,
  label    text,
  jumlah   int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not can_read_operational(p_entity_id) then
    return;
  end if;

  return query
  with prioritas(tabel, urut) as (
    values ('pencairan', 1), ('operasional_rekap', 2), ('pengeluaran', 3), ('laporan_pendapatan', 4),
           ('kapal', 5), ('kendaraan', 6), ('pemilik', 7), ('karyawan', 8), ('karyawan_catatan', 9),
           ('gaji_telly', 10), ('laporan_kumpulan', 11), ('transaksi_operasional', 12),
           ('pencairan_approval', 13), ('paguyuban', 14)
  ),
  baris as (
    select l.id, l.occurred_at, l.actor_id, l.table_name, l.action,
           coalesce(l.new_value, l.old_value) as v, p.urut
      from audit_log l
      join prioritas p on p.tabel = l.table_name
     where l.id > coalesce(p_setelah, 0)
       and l.occurred_at > now() - interval '1 day'
       and l.actor_id is not null
       and l.actor_id is distinct from auth.uid()
       and coalesce(l.new_value ->> 'entity_id', l.old_value ->> 'entity_id') = p_entity_id::text
  ),
  kelompok as (
    select distinct on (b.actor_id, b.occurred_at)
           b.actor_id, b.occurred_at, b.table_name, b.action, b.v,
           max(b.id) over (partition by b.actor_id, b.occurred_at) as id_akhir,
           count(*) over (partition by b.actor_id, b.occurred_at)::int as n
      from baris b
     order by b.actor_id, b.occurred_at, b.urut, b.id
  )
  select k.id_akhir,
         k.occurred_at,
         coalesce(pr.full_name, 'Pengguna lain'),
         k.action,
         k.table_name,
         case k.table_name
           when 'kapal'              then 'kapal ' || (k.v ->> 'nama_kapal')
           when 'kendaraan'          then 'kendaraan ' || (k.v ->> 'nopol')
           when 'pemilik'            then 'pemilik ' || (k.v ->> 'nama_pemilik')
           when 'karyawan'           then 'karyawan ' || (k.v ->> 'nama')
           when 'karyawan_catatan'   then 'catatan karyawan ' || coalesce(k.v ->> 'jenis', '')
           when 'operasional_rekap'  then 'kegiatan kapal ' || coalesce(
                                            (select nama_kapal from kapal where kapal.id = (k.v ->> 'kapal_id')::bigint), '')
           when 'transaksi_operasional' then 'rincian truk'
           when 'pengeluaran'        then 'pengeluaran ' || (k.v ->> 'jenis')
           when 'pencairan'          then 'invoice pencairan ' || (k.v ->> 'nomor_invoice')
           when 'pencairan_approval' then 'persetujuan ' || (k.v ->> 'departemen')
           when 'laporan_pendapatan' then 'pendapatan ' || coalesce(k.v ->> 'no_invoice', k.v ->> 'kegiatan')
           when 'gaji_telly'         then 'gaji karyawan'
           when 'laporan_kumpulan'   then 'kumpulan laporan'
           when 'paguyuban'          then 'iuran paguyuban'
         end,
         k.n
    from kelompok k
    left join profiles pr on pr.id = k.actor_id
   order by k.id_akhir
   limit 20;
end;
$$;

/** Titik mulai: notifikasi hanya untuk perubahan SESUDAH halaman dibuka. */
create or replace function kursor_aktivitas()
returns bigint
language sql
stable
security definer
set search_path = public
as $$ select coalesce(max(id), 0) from audit_log $$;

comment on function aktivitas_operasional(uuid, bigint) is
  'Ringkasan perubahan data operasional oleh pengguna lain (24 jam), satu baris per simpanan. Untuk toast kolaborasi.';

do $$
declare
  f text;
begin
  foreach f in array array['aktivitas_operasional(uuid, bigint)', 'kursor_aktivitas()'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
