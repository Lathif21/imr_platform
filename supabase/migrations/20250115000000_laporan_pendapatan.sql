-- =====================================================================
--  LAPORAN PENDAPATAN (Fase 4a)
--
--  LaporanController: pendapatan, generatePendapatan, storePendapatan,
--  updatePendapatan, bulkUpdatePendapatan, destroyPendapatan,
--  syncMissingShipsToPendapatan, syncToPencairan; dan dari
--  PencairanController::index, tarik invoice ke pencairan.
--
--  Rumus apa adanya: party = tonase kegiatan × 1.000 KG; total = party /
--  1.000 × harga per ton (default 34.500); pajak = total × tarif% (default
--  0,5); net = total − pajak; invoice "n/PT.IMR-<bulan romawi>/<tahun>".
--
--  PERBAIKAN, dicatat di docs/PENGGABUNGAN.md:
--    - baris pendapatan DITAUTKAN ke kegiatannya (operasional_rekap_id).
--      Laravel mencocokkan nama kapal sebagai substring, sehingga satu
--      kapal bisa menimpa atau menghapus invoice kapal lain yang namanya
--      mirip ("KM Sinar" di dalam "KM Sinar Jaya").
--    - sinkron berjalan saat kegiatan disimpan (trigger), bukan saat
--      halaman pendapatan dibuka. GET Laravel juga menghapus baris yang
--      dianggap duplikat dan menomori ulang invoice; di sini penomoran
--      ulang adalah aksi eksplisit, penghapusan duplikat tidak ada (tautan
--      unik membuat duplikat dari sinkron tidak mungkin).
--    - baris LUNAS / sudah dibayar tidak diubah oleh sinkron kegiatan.
--    - tarif pajak 0% yang dipilih tidak dikembalikan ke 0,5%.
--    - nomor invoice yang diganti ikut mengganti nomor di pencairan.
--      Laravel mencari pencairan dengan nomor baru, sehingga pencairan lama
--      terputus dari pendapatannya.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Tautan ke kegiatan
-- ---------------------------------------------------------------------

alter table laporan_pendapatan add column operasional_rekap_id bigint;

alter table laporan_pendapatan
  add constraint laporan_pendapatan_operasional_rekap_id_fkey
  foreign key (operasional_rekap_id, entity_id)
  references operasional_rekap (id, entity_id) on delete set null (operasional_rekap_id);

alter table laporan_pendapatan
  add constraint laporan_pendapatan_satu_per_kegiatan unique (operasional_rekap_id);

create index pendapatan_invoice_idx on laporan_pendapatan (entity_id, no_invoice);

comment on column laporan_pendapatan.operasional_rekap_id is
  'Kegiatan asal baris ini. NULL untuk baris manual, dari pencairan, atau dari migrasi data yang belum ditautkan.';


-- ---------------------------------------------------------------------
--  2. Pembantu
-- ---------------------------------------------------------------------

create or replace function nomor_invoice_otomatis(p_no_urut int, p_bulan int, p_tahun int)
returns text
language sql
immutable
as $$
  select p_no_urut || '/PT.IMR-'
      || (array['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'])[p_bulan]
      || '/' || p_tahun
$$;

/** "05 Oktober 2026", "05 s/d 07 Oktober 2026", "30 September s/d 02 Oktober 2026", "-". */
create or replace function teks_tanggal_kegiatan(p_mulai date, p_selesai date)
returns text
language plpgsql
immutable
as $$
declare
  nama text[] := array['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus',
                       'September','Oktober','November','Desember'];
  m1 text;
  m2 text;
begin
  if p_mulai is null then
    return '-';
  end if;
  m1 := nama[extract(month from p_mulai)::int];
  if p_selesai is null or p_selesai = p_mulai then
    return to_char(p_mulai, 'DD') || ' ' || m1 || ' ' || extract(year from p_mulai);
  end if;
  m2 := nama[extract(month from p_selesai)::int];
  if m1 = m2 and extract(year from p_mulai) = extract(year from p_selesai) then
    return to_char(p_mulai, 'DD') || ' s/d ' || to_char(p_selesai, 'DD') || ' ' || m1 || ' ' || extract(year from p_mulai);
  end if;
  return to_char(p_mulai, 'DD') || ' ' || m1 || ' s/d ' || to_char(p_selesai, 'DD') || ' ' || m2 || ' ' || extract(year from p_selesai);
end;
$$;

/** total = party/1000 × harga; pajak = total × tarif%; net = total − pajak (2 desimal). */
create or replace function hitung_tagihan(
  p_party_kg numeric, p_harga numeric, p_tarif numeric,
  out total numeric, out pajak numeric, out net numeric
)
language sql
immutable
as $$
  select round(p_party_kg / 1000 * p_harga, 2),
         round(round(p_party_kg / 1000 * p_harga, 2) * p_tarif / 100, 2),
         round(p_party_kg / 1000 * p_harga, 2) - round(round(p_party_kg / 1000 * p_harga, 2) * p_tarif / 100, 2)
$$;

/** Sudah dibayar: ada tanggal bayar, atau status LUNAS / PAID. */
create or replace function pendapatan_terkunci(p_status text, p_payment_date date)
returns boolean
language sql
immutable
as $$ select p_payment_date is not null or upper(btrim(coalesce(p_status, ''))) in ('LUNAS', 'PAID') $$;


-- ---------------------------------------------------------------------
--  3. Kegiatan → pendapatan (syncMissingShipsToPendapatan, per kegiatan)
--
--  Belum ada baris: baris lama tanpa tautan dengan nama kapal yang sama
--  persis di bulan itu diambil alih (hasil migrasi data atau dibuat dari
--  pencairan); bila tidak ada, baris baru dengan harga dan tarif default.
--  Sudah ada dan belum dibayar: party, total, pajak, net, lokasi, dan
--  tanggal mengikuti kegiatan bila party berubah (seperti Laravel); bulan
--  ikut bila kegiatan dipindah.
-- ---------------------------------------------------------------------

create or replace function sinkron_pendapatan_kegiatan(p_rekap_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r operasional_rekap;
  lp laporan_pendapatan;
  v_kapal text;
  v_party numeric;
  v_tgl text;
  v_lokasi text;
  v_no int;
  v_harga numeric;
  t record;
begin
  select * into r from operasional_rekap where id = p_rekap_id;
  if not found then
    return;
  end if;

  select nama_kapal into v_kapal from kapal where id = r.kapal_id;
  v_kapal := coalesce(v_kapal, 'Kapal');
  v_party := coalesce(r.tonase, 0) * 1000;
  v_tgl := teks_tanggal_kegiatan(r.tanggal_kegiatan, r.tanggal_selesai);
  v_lokasi := coalesce(nullif(btrim(r.rute), ''), '-');

  select * into lp from laporan_pendapatan where operasional_rekap_id = r.id;

  if not found then
    select * into lp
      from laporan_pendapatan
     where entity_id = r.entity_id and bulan = r.bulan and tahun = r.tahun
       and operasional_rekap_id is null
       and nama_banding(kegiatan) = nama_banding(v_kapal)
     order by (btrim(coalesce(tanggal_kegiatan, '')) = v_tgl
               or nama_banding(lokasi) = nama_banding(v_lokasi)) desc,
              no_urut nulls last, id
     limit 1;

    if found then
      update laporan_pendapatan set operasional_rekap_id = r.id where id = lp.id returning * into lp;
    else
      select coalesce(max(no_urut), 0) + 1 into v_no
        from laporan_pendapatan where entity_id = r.entity_id and bulan = r.bulan and tahun = r.tahun;
      select * into t from hitung_tagihan(v_party, 34500, 0.50);

      insert into laporan_pendapatan (
        entity_id, operasional_rekap_id, bulan, tahun, no_urut, no_invoice, kegiatan, lokasi,
        tanggal_kegiatan, party_kg, harga, total, tarif_pajak, pajak, net_tagihan
      ) values (
        r.entity_id, r.id, r.bulan, r.tahun, v_no, nomor_invoice_otomatis(v_no, r.bulan, r.tahun), v_kapal, v_lokasi,
        v_tgl, v_party, 34500, t.total, 0.50, t.pajak, t.net
      );
      return;
    end if;
  end if;

  if pendapatan_terkunci(lp.status_entry, lp.payment_date) then
    return;
  end if;

  if lp.bulan <> r.bulan or lp.tahun <> r.tahun then
    select coalesce(max(no_urut), 0) + 1 into v_no
      from laporan_pendapatan where entity_id = r.entity_id and bulan = r.bulan and tahun = r.tahun;
    update laporan_pendapatan set bulan = r.bulan, tahun = r.tahun, no_urut = v_no where id = lp.id;
  end if;

  if v_party > 0 and v_party <> lp.party_kg then
    v_harga := case when lp.harga > 0 then lp.harga else 34500 end;
    select * into t from hitung_tagihan(v_party, v_harga, lp.tarif_pajak);
    update laporan_pendapatan
       set lokasi           = case when v_lokasi <> '-' then v_lokasi else lokasi end,
           tanggal_kegiatan = case when v_tgl <> '-' then v_tgl else tanggal_kegiatan end,
           party_kg         = v_party,
           harga            = v_harga,
           total            = t.total,
           pajak            = t.pajak,
           net_tagihan      = t.net
     where id = lp.id;
  end if;
end;
$$;

create or replace function trg_rekap_ke_pendapatan()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- destroy() Laravel menghapus pendapatan kapal itu. Di sini hanya baris
    -- kegiatan ini, dan hanya bila belum dibayar dan belum punya pencairan;
    -- selain itu baris tetap ada tanpa tautan.
    delete from laporan_pendapatan lp
     where lp.operasional_rekap_id = old.id
       and not pendapatan_terkunci(lp.status_entry, lp.payment_date)
       and not exists (
         select 1 from pencairan p where p.entity_id = lp.entity_id and p.nomor_invoice = lp.no_invoice
       );
    return old;
  end if;

  perform sinkron_pendapatan_kegiatan(new.id);
  return new;
end;
$$;

create trigger operasional_rekap_pendapatan
  after insert or update of kapal_id, bulan, tahun, rute, tonase, tanggal_kegiatan, tanggal_selesai
  on operasional_rekap
  for each row execute function trg_rekap_ke_pendapatan();

create trigger operasional_rekap_pendapatan_hapus
  before delete on operasional_rekap
  for each row execute function trg_rekap_ke_pendapatan();


-- ---------------------------------------------------------------------
--  4. Pendapatan → pencairan (syncToPencairan)
--
--  Nominal pencairan = total (atau net bila total 0), pajak = pajak; hanya
--  bila nominal > 0, seperti Laravel. PERBAIKAN: nomor invoice yang
--  diganti ikut diganti di pencairan.
-- ---------------------------------------------------------------------

create or replace function trg_pendapatan_ke_pencairan()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nominal numeric;
begin
  if tg_op = 'UPDATE'
     and old.no_invoice is not null and new.no_invoice is not null
     and btrim(old.no_invoice) <> btrim(new.no_invoice) then
    update pencairan set nomor_invoice = btrim(new.no_invoice)
     where entity_id = new.entity_id and nomor_invoice = btrim(old.no_invoice);
  end if;

  if new.no_invoice is null or btrim(new.no_invoice) = '' then
    return new;
  end if;

  v_nominal := case when new.total > 0 then new.total else new.net_tagihan end;
  if v_nominal > 0 then
    update pencairan
       set nominal_invoice = v_nominal,
           besaran_pajak   = new.pajak
     where entity_id = new.entity_id
       and nomor_invoice = btrim(new.no_invoice)
       and (nominal_invoice, besaran_pajak) is distinct from (v_nominal, new.pajak);
  end if;
  return new;
end;
$$;

create trigger laporan_pendapatan_pencairan
  after insert or update of no_invoice, total, pajak, net_tagihan
  on laporan_pendapatan
  for each row execute function trg_pendapatan_ke_pencairan();


-- ---------------------------------------------------------------------
--  5. Aksi layar
-- ---------------------------------------------------------------------

/**
 * "Generate dari Kegiatan" — generatePendapatan. Menjalankan sinkron untuk
 * setiap kegiatan bulan itu (berguna untuk kegiatan yang ada sebelum
 * trigger, atau baris pendapatan yang terhapus). Mengembalikan jumlah baris
 * baru.
 */
create or replace function generate_pendapatan(p_entity_id uuid, p_bulan int, p_tahun int)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sebelum int;
  v_sesudah int;
  v_id bigint;
begin
  select count(*) into v_sebelum from laporan_pendapatan where entity_id = p_entity_id and bulan = p_bulan and tahun = p_tahun;
  for v_id in
    select id from operasional_rekap where entity_id = p_entity_id and bulan = p_bulan and tahun = p_tahun order by id
  loop
    perform sinkron_pendapatan_kegiatan(v_id);
  end loop;
  select count(*) into v_sesudah from laporan_pendapatan where entity_id = p_entity_id and bulan = p_bulan and tahun = p_tahun;
  return v_sesudah - v_sebelum;
end;
$$;

/**
 * Tambah Baris Pendapatan Manual — storePendapatan. Nomor urut kosong =
 * berikutnya; nomor invoice kosong = otomatis (Laravel mengisinya saat
 * halaman dibuka berikutnya).
 */
create or replace function tambah_pendapatan(p_entity_id uuid, p_bulan int, p_tahun int, p_data jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_no int := nullif(p_data->>'no_urut', '')::int;
  v_party numeric := coalesce(nullif(p_data->>'party_kg', '')::numeric, 0);
  v_harga numeric := coalesce(nullif(p_data->>'harga', '')::numeric, 0);
  v_tarif numeric := coalesce(nullif(p_data->>'tarif_pajak', '')::numeric, 0.5);
  t record;
  v_id bigint;
begin
  if v_no is null then
    select coalesce(max(no_urut), 0) + 1 into v_no
      from laporan_pendapatan where entity_id = p_entity_id and bulan = p_bulan and tahun = p_tahun;
  end if;
  select * into t from hitung_tagihan(v_party, v_harga, v_tarif);

  insert into laporan_pendapatan (
    entity_id, bulan, tahun, no_urut, no_invoice, kegiatan, no_faktur_pajak, no_sto_spo, lokasi,
    tanggal_kegiatan, party_kg, harga, total, tarif_pajak, pajak, net_tagihan,
    status_entry, tanggal_entry, payment_date, keterangan
  ) values (
    p_entity_id, p_bulan, p_tahun, v_no,
    coalesce(nullif(btrim(p_data->>'no_invoice'), ''), nomor_invoice_otomatis(v_no, p_bulan, p_tahun)),
    btrim(p_data->>'kegiatan'), nullif(btrim(p_data->>'no_faktur_pajak'), ''), nullif(btrim(p_data->>'no_sto_spo'), ''),
    nullif(btrim(p_data->>'lokasi'), ''), nullif(btrim(p_data->>'tanggal_kegiatan'), ''),
    v_party, v_harga, t.total, v_tarif, t.pajak, t.net,
    nullif(btrim(p_data->>'status_entry'), ''), nullif(p_data->>'tanggal_entry', '')::date,
    nullif(p_data->>'payment_date', '')::date, nullif(btrim(p_data->>'keterangan'), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * "Simpan Semua" — bulkUpdatePendapatan, satu transaksi. Total, pajak, dan
 * net selalu dihitung ulang dari party, harga, dan tarif. Tanggal entry
 * kosong = tetap; tanggal bayar kosong = dikosongkan (Laravel).
 */
create or replace function simpan_pendapatan_massal(p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
  lp laporan_pendapatan;
  v_party numeric;
  v_harga numeric;
  v_tarif numeric;
  t record;
  v_n int := 0;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into lp from laporan_pendapatan where id = (v_row->>'id')::bigint for update;
    if not found then
      raise exception 'Baris pendapatan tidak ditemukan, atau akun Anda tidak berwenang mengubahnya. Muat ulang halaman lalu coba lagi.';
    end if;

    v_party := coalesce(nullif(v_row->>'party_kg', '')::numeric, lp.party_kg);
    v_harga := coalesce(nullif(v_row->>'harga', '')::numeric, lp.harga);
    v_tarif := coalesce(nullif(v_row->>'tarif_pajak', '')::numeric, lp.tarif_pajak);
    select * into t from hitung_tagihan(v_party, v_harga, v_tarif);

    update laporan_pendapatan
       set no_urut          = coalesce(nullif(v_row->>'no_urut', '')::int, no_urut),
           no_invoice       = coalesce(nullif(btrim(v_row->>'no_invoice'), ''), no_invoice),
           kegiatan         = coalesce(nullif(btrim(v_row->>'kegiatan'), ''), kegiatan),
           no_faktur_pajak  = nullif(btrim(coalesce(v_row->>'no_faktur_pajak', no_faktur_pajak)), ''),
           no_sto_spo       = nullif(btrim(coalesce(v_row->>'no_sto_spo', no_sto_spo)), ''),
           lokasi           = nullif(btrim(coalesce(v_row->>'lokasi', lokasi)), ''),
           tanggal_kegiatan = nullif(btrim(coalesce(v_row->>'tanggal_kegiatan', tanggal_kegiatan)), ''),
           party_kg         = v_party,
           harga            = v_harga,
           total            = t.total,
           tarif_pajak      = v_tarif,
           pajak            = t.pajak,
           net_tagihan      = t.net,
           status_entry     = nullif(btrim(coalesce(v_row->>'status_entry', status_entry)), ''),
           tanggal_entry    = coalesce(nullif(v_row->>'tanggal_entry', '')::date, tanggal_entry),
           payment_date     = nullif(v_row->>'payment_date', '')::date,
           keterangan       = nullif(btrim(coalesce(v_row->>'keterangan', keterangan)), '')
     where id = lp.id;
    if not found then
      raise exception 'Akun Anda tidak berwenang mengubah data operasional entitas ini.';
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

/**
 * "Rapikan Nomor" — penomoran ulang yang di Laravel berjalan setiap kali
 * halaman dibuka. Nomor urut menjadi 1..n menurut urutan sekarang; nomor
 * invoice berpola otomatis (atau kosong) mengikuti, kecuali baris yang
 * sudah dibayar — invoicenya sudah dikirim ke pelanggan. Pencairan ikut
 * lewat trigger.
 */
create or replace function rapikan_nomor_pendapatan(p_entity_id uuid, p_bulan int, p_tahun int)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  lp record;
  v_i int := 0;
  v_n int := 0;
  v_invoice text;
begin
  for lp in
    select * from laporan_pendapatan
     where entity_id = p_entity_id and bulan = p_bulan and tahun = p_tahun
     order by no_urut nulls last, id
     for update
  loop
    v_i := v_i + 1;
    v_invoice := case
      when not pendapatan_terkunci(lp.status_entry, lp.payment_date)
       and (lp.no_invoice is null or btrim(lp.no_invoice) = '' or lp.no_invoice ~* '^\d+/PT\.IMR-')
      then nomor_invoice_otomatis(v_i, p_bulan, p_tahun)
      else lp.no_invoice
    end;
    if lp.no_urut is distinct from v_i or lp.no_invoice is distinct from v_invoice then
      update laporan_pendapatan set no_urut = v_i, no_invoice = v_invoice where id = lp.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

/**
 * Pencairan → "Tarik dari Laporan Pendapatan". Bagian dari
 * PencairanController::index yang berjalan setiap GET, di sini aksi
 * eksplisit dan hanya MENAMBAH: setiap invoice bulan itu yang belum punya
 * pencairan. Kapal dari kegiatan yang tertaut, atau kapal dengan nama sama
 * persis; tanpa itu dilewati (Laravel menebak substring lalu kapal
 * pertama). Nominal = total (bruto).
 */
create or replace function tarik_pencairan(p_entity_id uuid, p_bulan int, p_tahun int)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  lp record;
  v_kapal bigint;
  v_id bigint;
  v_dibuat int := 0;
  v_lewat text[] := '{}';
begin
  for lp in
    select l.*, r.kapal_id as rekap_kapal
      from laporan_pendapatan l
      left join operasional_rekap r on r.id = l.operasional_rekap_id
     where l.entity_id = p_entity_id and l.bulan = p_bulan and l.tahun = p_tahun
       and nullif(btrim(l.no_invoice), '') is not null
       and not exists (select 1 from pencairan p where p.entity_id = l.entity_id and p.nomor_invoice = btrim(l.no_invoice))
     order by l.no_urut nulls last, l.id
  loop
    v_kapal := lp.rekap_kapal;
    if v_kapal is null then
      select id into v_kapal from kapal
       where entity_id = p_entity_id and nama_banding(nama_kapal) = nama_banding(lp.kegiatan)
       order by id limit 1;
    end if;
    if v_kapal is null then
      v_lewat := v_lewat || (btrim(lp.no_invoice) || ' (' || lp.kegiatan || ')');
      continue;
    end if;

    insert into pencairan (entity_id, kapal_id, bulan, tahun, nomor_invoice, nominal_invoice, besaran_pajak, status)
    values (p_entity_id, v_kapal, p_bulan, p_tahun, btrim(lp.no_invoice),
            case when lp.total > 0 then lp.total else lp.net_tagihan end, lp.pajak, 'Pending')
    returning id into v_id;

    insert into pencairan_approval (entity_id, pencairan_id, departemen, status)
    select p_entity_id, v_id, d, 'Pending' from unnest(array['Jetty', 'Gudang', 'Accounting']) d;

    v_dibuat := v_dibuat + 1;
    v_kapal := null;
  end loop;

  return jsonb_build_object('dibuat', v_dibuat, 'dilewati', to_jsonb(v_lewat));
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
    'nomor_invoice_otomatis(int, int, int)',
    'teks_tanggal_kegiatan(date, date)',
    'hitung_tagihan(numeric, numeric, numeric)',
    'pendapatan_terkunci(text, date)',
    'sinkron_pendapatan_kegiatan(bigint)',
    'generate_pendapatan(uuid, int, int)',
    'tambah_pendapatan(uuid, int, int, jsonb)',
    'simpan_pendapatan_massal(jsonb)',
    'rapikan_nomor_pendapatan(uuid, int, int)',
    'tarik_pencairan(uuid, int, int)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
