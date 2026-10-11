-- =====================================================================
--  PENCAIRAN (Fase 3)
--
--  PencairanController: invoice per kapal, persetujuan bertahap tiga
--  departemen (Jetty, Gudang, Accounting), dan sinkron status ke Laporan
--  Pendapatan (status_entry PENDING → PROSES PAYMENT). Laravel menulis
--  pencairan, approval, dan pendapatan berurutan; di sini setiap aksi
--  satu fungsi, security invoker (RLS pemanggil berlaku).
--
--  PERBAIKAN yang dicatat di docs/PENGGABUNGAN.md:
--    - pencairan punya TAHUN. Laravel hanya menyimpan bulan dan memakai
--      tahun jam server saat menyinkronkan ke pendapatan, sehingga invoice
--      Desember yang disetujui Januari pindah ke tahun berikutnya.
--    - status pencairan hanya diturunkan dari persetujuan. Laravel
--      membiarkan form Ubah dan tombol Proses Payment menimpanya.
--    - pendapatan yang sudah LUNAS atau punya tanggal bayar tidak diubah
--      oleh Ubah invoice (Laravel hanya menjaganya saat approval).
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Tahun
-- ---------------------------------------------------------------------

alter table pencairan add column tahun smallint;
update pencairan set tahun = extract(year from created_at at time zone 'Asia/Jakarta')::smallint;
alter table pencairan alter column tahun set not null;
alter table pencairan alter column tahun set default extract(year from now() at time zone 'Asia/Jakarta')::smallint;

comment on column pencairan.tahun is
  'Tahun periode invoice. Tidak ada di Laravel (diambil dari jam server); data lama diisi dari created_at.';

create index pencairan_entity_periode_idx on pencairan (entity_id, tahun, bulan);


-- ---------------------------------------------------------------------
--  2. Pembantu
-- ---------------------------------------------------------------------

/**
 * Status pencairan dari ketiga persetujuannya: semua Approved → Approved;
 * ada yang Rejected → Rejected; selain itu Pending. Sama dengan
 * updateApproval, dan satu-satunya cara status berubah.
 */
create or replace function turunkan_status_pencairan(p_pencairan_id bigint)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
begin
  select case
           when count(*) >= 3 and bool_and(status = 'Approved') then 'Approved'
           when bool_or(status = 'Rejected') then 'Rejected'
           else 'Pending'
         end
    into v_status
    from pencairan_approval
   where pencairan_id = p_pencairan_id;

  update pencairan set status = v_status where id = p_pencairan_id and status is distinct from v_status;
  return v_status;
end;
$$;

/**
 * Baris Laporan Pendapatan untuk invoice ini — syncToLaporanPendapatan.
 *
 * Dicari menurut nomor invoice (lama, lalu baru) di entitas yang sama;
 * dibuat bila belum ada, dengan nomor urut berikutnya di bulannya.
 * Total = nominal invoice, pajak = besaran pajak, net = total − pajak.
 * Baris yang sudah LUNAS atau punya tanggal bayar tidak disentuh.
 * p_status_entry null = status pendapatan tidak diubah (form Ubah).
 */
create or replace function sinkron_pendapatan_pencairan(
  p_pencairan_id  bigint,
  p_status_entry  text,
  p_invoice_lama  text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  p pencairan;
  lp laporan_pendapatan;
  v_kapal text;
  v_no_urut int;
begin
  select * into p from pencairan where id = p_pencairan_id;
  if not found then
    return;
  end if;

  select * into lp
    from laporan_pendapatan
   where entity_id = p.entity_id and no_invoice = coalesce(p_invoice_lama, p.nomor_invoice)
   order by id limit 1;
  if not found and p_invoice_lama is not null then
    select * into lp
      from laporan_pendapatan
     where entity_id = p.entity_id and no_invoice = p.nomor_invoice
     order by id limit 1;
  end if;

  if lp.id is null then
    select nama_kapal into v_kapal from kapal where id = p.kapal_id;
    select coalesce(max(no_urut), count(*)::int, 0) + 1 into v_no_urut
      from laporan_pendapatan
     where entity_id = p.entity_id and bulan = p.bulan and tahun = p.tahun;

    insert into laporan_pendapatan (
      entity_id, bulan, tahun, no_urut, no_invoice, kegiatan, party_kg, harga,
      total, tarif_pajak, pajak, net_tagihan, status_entry, tanggal_entry
    ) values (
      p.entity_id, p.bulan, p.tahun, v_no_urut, p.nomor_invoice, coalesce(v_kapal, 'Kegiatan Kapal'), 0, 0,
      p.nominal_invoice, 0.5, p.besaran_pajak, p.nominal_invoice - p.besaran_pajak,
      coalesce(p_status_entry, 'PENDING'), (now() at time zone 'Asia/Jakarta')::date
    );
    return;
  end if;

  if upper(btrim(coalesce(lp.status_entry, ''))) = 'LUNAS' or lp.payment_date is not null then
    return;
  end if;

  update laporan_pendapatan
     set no_invoice   = p.nomor_invoice,
         bulan        = p.bulan,
         tahun        = p.tahun,
         total        = p.nominal_invoice,
         pajak        = p.besaran_pajak,
         net_tagihan  = p.nominal_invoice - p.besaran_pajak,
         status_entry = coalesce(p_status_entry, status_entry)
   where id = lp.id;
end;
$$;


-- ---------------------------------------------------------------------
--  3. Tambah / ubah invoice
--
--  store: pencairan + tiga persetujuan Pending + pendapatan PENDING.
--  update: data invoice saja; status tetap dari persetujuan.
-- ---------------------------------------------------------------------

create or replace function simpan_pencairan(
  p_entity_id  uuid,
  p_id         bigint,
  p_kapal_id   bigint,
  p_bulan      int,
  p_tahun      int,
  p_nomor      text,
  p_nominal    numeric,
  p_pajak      numeric
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id bigint;
  v_lama text;
begin
  perform 1 from kapal where id = p_kapal_id and entity_id = p_entity_id;
  if not found then
    raise exception 'Kapal tidak ditemukan di entitas ini.';
  end if;

  if p_id is null then
    insert into pencairan (entity_id, kapal_id, bulan, tahun, nomor_invoice, nominal_invoice, besaran_pajak, status)
    values (p_entity_id, p_kapal_id, p_bulan, p_tahun, btrim(p_nomor), p_nominal, coalesce(p_pajak, 0), 'Pending')
    returning id into v_id;

    insert into pencairan_approval (entity_id, pencairan_id, departemen, status)
    select p_entity_id, v_id, d, 'Pending' from unnest(array['Jetty', 'Gudang', 'Accounting']) d;

    perform sinkron_pendapatan_pencairan(v_id, 'PENDING');
    return v_id;
  end if;

  select nomor_invoice into v_lama from pencairan where id = p_id and entity_id = p_entity_id for update;
  if not found then
    raise exception 'Invoice pencairan tidak ditemukan, atau akun Anda tidak berwenang mengubahnya.';
  end if;

  update pencairan
     set kapal_id        = p_kapal_id,
         bulan           = p_bulan,
         tahun           = p_tahun,
         nomor_invoice   = btrim(p_nomor),
         nominal_invoice = p_nominal,
         besaran_pajak   = coalesce(p_pajak, 0)
   where id = p_id;
  if not found then
    raise exception 'Akun Anda tidak berwenang mengubah data operasional entitas ini.';
  end if;

  perform sinkron_pendapatan_pencairan(p_id, null, v_lama);
  return p_id;
end;
$$;


-- ---------------------------------------------------------------------
--  4. Persetujuan departemen — updateApproval
--
--  Tanggal tanda tangan kosong = hari ini (Laravel). Status pencairan
--  diturunkan ulang; pendapatan menjadi PROSES PAYMENT bila ketiganya
--  menyetujui, selain itu PENDING.
-- ---------------------------------------------------------------------

create or replace function setujui_pencairan(
  p_pencairan_id bigint,
  p_departemen   text,
  p_status       text,
  p_tanggal_ttd  date,
  p_keterangan   text
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
begin
  perform 1 from pencairan where id = p_pencairan_id for update;
  if not found then
    raise exception 'Invoice pencairan tidak ditemukan, atau akun Anda tidak berwenang mengubahnya.';
  end if;

  update pencairan_approval
     set status      = p_status,
         tanggal_ttd = coalesce(p_tanggal_ttd, (now() at time zone 'Asia/Jakarta')::date),
         keterangan  = p_keterangan
   where pencairan_id = p_pencairan_id and departemen = p_departemen;
  if not found then
    raise exception 'Persetujuan departemen % tidak ditemukan, atau akun Anda tidak berwenang mengubahnya.', p_departemen;
  end if;

  v_status := turunkan_status_pencairan(p_pencairan_id);
  perform sinkron_pendapatan_pencairan(
    p_pencairan_id,
    case when v_status = 'Approved' then 'PROSES PAYMENT' else 'PENDING' end
  );
  return v_status;
end;
$$;


-- ---------------------------------------------------------------------
--  5. Hapus — destroy
--
--  Pencairan dan persetujuannya (CASCADE), ditambah baris pendapatan
--  invoice yang sama yang belum dibayar, seperti Laravel. Dicocokkan
--  menurut nomor invoice persis di entitas yang sama.
-- ---------------------------------------------------------------------

create or replace function hapus_pencairan(p_pencairan_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  p pencairan;
begin
  select * into p from pencairan where id = p_pencairan_id;
  if not found then
    raise exception 'Invoice pencairan tidak ditemukan, atau akun Anda tidak berwenang menghapusnya.';
  end if;

  delete from pencairan where id = p.id;
  if not found then
    raise exception 'Akun Anda tidak berwenang mengubah data operasional entitas ini.';
  end if;

  delete from laporan_pendapatan
   where entity_id = p.entity_id
     and no_invoice = p.nomor_invoice
     and payment_date is null
     and upper(btrim(coalesce(status_entry, ''))) <> 'LUNAS';
end;
$$;


-- ---------------------------------------------------------------------
--  6. Hak eksekusi
-- ---------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'turunkan_status_pencairan(bigint)',
    'sinkron_pendapatan_pencairan(bigint, text, text)',
    'simpan_pencairan(uuid, bigint, bigint, int, int, text, numeric, numeric)',
    'setujui_pencairan(bigint, text, text, date, text)',
    'hapus_pencairan(bigint)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
