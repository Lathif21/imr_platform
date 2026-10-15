-- =====================================================================
--  Nomor urut invoice tidak boleh kembar karena dua orang menyimpan
--  bersamaan
--
--  Setiap baris Laporan Pendapatan baru mendapat
--  `coalesce(max(no_urut), 0) + 1` untuk entitas-bulan-tahunnya, dan
--  nomor invoice otomatis diturunkan dari angka itu. Tanpa kunci, dua
--  transaksi yang berjalan bersamaan — dua admin menyimpan kegiatan,
--  atau "Generate" yang ditekan dua kali — membaca max yang sama dan
--  sama-sama menulis no_urut N+1: dua tagihan dengan nomor invoice yang
--  sama. Tidak ada constraint unik yang menangkapnya, karena nomor
--  manual memang boleh diatur pengguna (simpan_pendapatan_massal).
--
--  Perbaikannya kunci advisory per (entitas, bulan, tahun), dipegang
--  sampai transaksi selesai, diambil tepat sebelum setiap max(no_urut).
--  Transaksi kedua menunggu yang pertama commit, lalu — fungsi-fungsi ini
--  VOLATILE, jadi setiap statement memakai snapshot baru — membaca max
--  yang sudah memuat baris pertama. Bulan lain dan entitas lain tidak
--  saling menunggu.
--
--  Badan fungsi di bawah diambil dari definisi yang berlaku
--  (pg_get_functiondef) dan hanya disisipi baris `perform
--  kunci_nomor_pendapatan(...)`. Tidak ada logika lain yang berubah.
-- =====================================================================

create or replace function kunci_nomor_pendapatan(p_entity_id uuid, p_bulan integer, p_tahun integer)
returns void
language sql
volatile
as $$
  select pg_advisory_xact_lock(
    hashtextextended(format('laporan_pendapatan.no_urut:%s:%s:%s', p_entity_id, p_tahun, p_bulan), 0)
  );
$$;

comment on function kunci_nomor_pendapatan(uuid, integer, integer) is
  'Kunci transaksi untuk penomoran Laporan Pendapatan satu entitas-bulan. Ambil sebelum membaca max(no_urut).';

revoke all on function kunci_nomor_pendapatan(uuid, integer, integer) from public;
grant execute on function kunci_nomor_pendapatan(uuid, integer, integer) to authenticated;

-- sinkron_pendapatan_kegiatan: 2 titik penomoran
CREATE OR REPLACE FUNCTION public.sinkron_pendapatan_kegiatan(p_rekap_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
      perform kunci_nomor_pendapatan(r.entity_id, r.bulan, r.tahun);
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
    perform kunci_nomor_pendapatan(r.entity_id, r.bulan, r.tahun);
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
$function$;

-- tambah_pendapatan: 1 titik penomoran
CREATE OR REPLACE FUNCTION public.tambah_pendapatan(p_entity_id uuid, p_bulan integer, p_tahun integer, p_data jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_no int := nullif(p_data->>'no_urut', '')::int;
  v_party numeric := coalesce(nullif(p_data->>'party_kg', '')::numeric, 0);
  v_harga numeric := coalesce(nullif(p_data->>'harga', '')::numeric, 0);
  v_tarif numeric := coalesce(nullif(p_data->>'tarif_pajak', '')::numeric, 0.5);
  t record;
  v_id bigint;
begin
  if v_no is null then
    perform kunci_nomor_pendapatan(p_entity_id, p_bulan, p_tahun);
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
$function$;

-- sinkron_pendapatan_pencairan: 1 titik penomoran
CREATE OR REPLACE FUNCTION public.sinkron_pendapatan_pencairan(p_pencairan_id bigint, p_status_entry text, p_invoice_lama text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    perform kunci_nomor_pendapatan(p.entity_id, p.bulan, p.tahun);
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
$function$;

-- rapikan_nomor_pendapatan: 1 titik penomoran
CREATE OR REPLACE FUNCTION public.rapikan_nomor_pendapatan(p_entity_id uuid, p_bulan integer, p_tahun integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  lp record;
  v_i int := 0;
  v_n int := 0;
  v_invoice text;
begin
  perform kunci_nomor_pendapatan(p_entity_id, p_bulan, p_tahun);
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
$function$;

