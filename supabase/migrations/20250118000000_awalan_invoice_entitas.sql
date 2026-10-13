-- =====================================================================
--  Awalan nomor invoice per entitas.
--
--  Nomor invoice otomatis Laporan Pendapatan berbentuk
--  "n/<awalan>-<bulan romawi>/<tahun>". Sampai migrasi ini awalannya
--  tertanam "PT.IMR" — singkatan PT Indo Moda Raya (ILJ), satu-satunya
--  entitas yang memakai modul operasional. Sejak PT ILA ikut memakainya
--  (diputuskan 13 Oktober 2026), setiap entitas mencetak singkatannya
--  sendiri: `entities.invoice_prefix`, atau "PT.<kode>" bila kosong.
--
--  ILJ tetap PT.IMR, jadi invoice yang sudah terkirim tidak berubah.
--  Fungsi 3-argumen lama dibiarkan: tidak ada lagi yang memanggilnya, dan
--  migrasi bersifat maju saja.
-- =====================================================================

alter table entities add column invoice_prefix text
  check (invoice_prefix is null or invoice_prefix ~ '^[A-Za-z0-9.]+$');

comment on column entities.invoice_prefix is
  'Awalan nomor invoice otomatis Laporan Pendapatan, mis. PT.IMR. Kosong = "PT." || code.';

update entities set invoice_prefix = 'PT.IMR' where code = 'ILJ' and invoice_prefix is null;

create or replace function awalan_invoice(p_entity_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(nullif(btrim(invoice_prefix), ''), 'PT.' || code) from entities where id = p_entity_id
$$;

create or replace function nomor_invoice_otomatis(p_entity_id uuid, p_no_urut int, p_bulan int, p_tahun int)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select p_no_urut || '/' || awalan_invoice(p_entity_id) || '-'
      || (array['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'])[p_bulan]
      || '/' || p_tahun
$$;

/**
 * Apakah nomor ini dibuat otomatis untuk entitas itu — "n/<awalan>-...".
 * Rapikan Nomor hanya menomori ulang invoice seperti ini; yang diketik
 * manual dibiarkan. Awalan dibandingkan apa adanya, bukan sebagai regex.
 */
create or replace function invoice_berpola_otomatis(p_entity_id uuid, p_no_invoice text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select p_no_invoice ~ '^\d+/'
     and upper(substr(p_no_invoice, strpos(p_no_invoice, '/') + 1, length(awalan_invoice(p_entity_id)) + 1))
         = upper(awalan_invoice(p_entity_id) || '-')
$$;

-- Tiga pemanggil nomor otomatis, isinya sama dengan 20250115000000 kecuali
-- nomor invoice yang kini membawa entitasnya.

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
        r.entity_id, r.id, r.bulan, r.tahun, v_no, nomor_invoice_otomatis(r.entity_id, v_no, r.bulan, r.tahun), v_kapal, v_lokasi,
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
    coalesce(nullif(btrim(p_data->>'no_invoice'), ''), nomor_invoice_otomatis(p_entity_id, v_no, p_bulan, p_tahun)),
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
       and (lp.no_invoice is null or btrim(lp.no_invoice) = '' or invoice_berpola_otomatis(p_entity_id, lp.no_invoice))
      then nomor_invoice_otomatis(p_entity_id, v_i, p_bulan, p_tahun)
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'awalan_invoice(uuid)',
    'nomor_invoice_otomatis(uuid, int, int, int)',
    'invoice_berpola_otomatis(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
