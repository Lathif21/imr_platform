-- =====================================================================
--  OPERASIONAL: PEMBACA BARU DAN REFERENSI YANG TERKUNCI PER ENTITAS
--
--  Dua keputusan 7 Oktober 2026 (docs/PENGGABUNGAN.md):
--
--    Q-3  manajer_keuangan dan auditor boleh MEMBACA data operasional
--         entitas yang ditugaskan — supaya asal angka P&L bisa ditelusuri
--         saat persetujuan dan audit. Hak tulis tidak berubah:
--         admin_operasional saja.
--
--    Q-6  baris operasional tidak boleh menunjuk baris entitas lain.
--         Sampai migrasi ini, kendaraan ILJ bisa saja menunjuk pemilik
--         milik AMDK: RLS hanya memeriksa entity_id baris yang ditulis,
--         bukan baris yang dirujuknya. Laporan ILJ lalu menjumlahkan
--         pembayaran ke rekanan yang di entitasnya sendiri tidak ada.
--
--  Q-6 dikerjakan sekarang karena tabel operasional masih kosong di
--  production. Setelah data dimigrasi, menambah constraint ini berarti
--  memeriksa — dan mungkin memperbaiki — setiap baris lama dulu.
-- =====================================================================


-- --- Q-3 -----------------------------------------------------------------

create or replace function can_read_operational(target_entity uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
           current_user_role() in ('direksi', 'admin_operasional', 'manajer_keuangan', 'auditor'),
           false
         )
     and has_entity_access(target_entity);
$$;

comment on function can_read_operational(uuid) is
  'Boleh membaca data operasional entitas ini: direksi, admin_operasional, '
  'manajer_keuangan, auditor. Menulis tetap can_write_operational().';


-- --- Q-6 -----------------------------------------------------------------
--
--  Setiap foreign key antar-tabel operasional menjadi komposit
--  (kolom_fk, entity_id) -> induk(id, entity_id). Induk karenanya butuh
--  unique (id, entity_id) — redundan secara logika karena id sudah unik,
--  tetapi Postgres hanya mengizinkan foreign key ke kolom yang dijamin
--  unik bersama-sama.
--
--  Aksi on delete dipertahankan. Untuk SET NULL, daftar kolomnya
--  disebut: `set null (kolom_fk)`. Tanpa itu Postgres mengosongkan
--  SEMUA kolom foreign key, termasuk entity_id — yang NOT NULL, sehingga
--  penghapusan induk gagal alih-alih melepas rujukannya.
--
--  MATCH SIMPLE (bawaan): rujukan yang kosong tidak diperiksa, persis
--  seperti foreign key satu kolom sebelumnya.

do $$
declare
  parent text;
  fk record;
begin
  foreach parent in array array[
    'pemilik', 'kapal', 'karyawan', 'kendaraan', 'kapal_rute',
    'kapal_muatan_detail', 'operasional_rekap', 'transaksi_operasional', 'pencairan'
  ]
  loop
    execute format(
      'alter table %1$I add constraint %1$s_id_entity_key unique (id, entity_id)', parent);
  end loop;

  for fk in
    select * from (values
      ('karyawan_catatan',      'karyawan_id',            'karyawan',              'cascade'),
      ('kendaraan',             'pemilik_id',             'pemilik',               'cascade'),
      ('kapal_rute',            'kapal_id',               'kapal',                 'cascade'),
      ('kapal_muatan_detail',   'kapal_id',               'kapal',                 'cascade'),
      ('kapal_muatan_detail',   'kendaraan_id',           'kendaraan',             'cascade'),
      ('kapal_muatan_detail',   'kapal_rute_id',          'kapal_rute',            'set null'),
      ('operasional_rekap',     'kapal_id',               'kapal',                 'cascade'),
      ('operasional_rekap',     'telly_id',               'karyawan',              'set null'),
      ('transaksi_operasional', 'kapal_id',               'kapal',                 'cascade'),
      ('transaksi_operasional', 'operasional_rekap_id',   'operasional_rekap',     'cascade'),
      ('transaksi_operasional', 'kendaraan_id',           'kendaraan',             'cascade'),
      ('transaksi_operasional', 'kapal_muatan_detail_id', 'kapal_muatan_detail',   'set null'),
      ('transaksi_operasional', 'telly_id',               'karyawan',              'set null'),
      ('gaji_telly',            'karyawan_id',            'karyawan',              'cascade'),
      ('gaji_telly',            'transaksi_id',           'transaksi_operasional', 'cascade'),
      ('gaji_telly',            'operasional_rekap_id',   'operasional_rekap',     'set null'),
      ('paguyuban',             'transaksi_id',           'transaksi_operasional', 'cascade'),
      ('pencairan',             'kapal_id',               'kapal',                 'cascade'),
      ('pencairan_approval',    'pencairan_id',           'pencairan',             'cascade')
    ) as t(child, col, parent, on_delete)
  loop
    execute format('alter table %I drop constraint %I', fk.child, fk.child || '_' || fk.col || '_fkey');
    execute format(
      'alter table %1$I add constraint %2$I foreign key (%3$I, entity_id)
         references %4$I (id, entity_id) on delete %5$s',
      fk.child,
      fk.child || '_' || fk.col || '_fkey',
      fk.col,
      fk.parent,
      case fk.on_delete when 'set null' then format('set null (%I)', fk.col) else 'cascade' end
    );
  end loop;
end;
$$;
