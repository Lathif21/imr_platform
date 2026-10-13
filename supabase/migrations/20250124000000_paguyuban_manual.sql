-- =====================================================================
--  Iuran paguyuban diisi manual per truk
--
--  Dulu sinkron_paguyuban() menghitung iuran setiap kali rincian truk
--  disimpan: tonase × tarif (Rp 500/ton), dan menghapusnya bila tonase 0.
--  Sekarang iuran adalah angka yang diketik di Rincian Pembayaran Truk
--  (atau kolom Paguyuban di impor Excel):
--    tidak ada baris paguyuban  belum diisi
--    total_bayar 0              diisi Rp 0
--
--  sinkron_paguyuban() kini hanya menjaga tanggal dan tarif. tarif tidak
--  lagi menjadi masukan: ia turunan iuran ÷ tonase, untuk kolom Tarif di
--  Laporan Paguyuban (0 bila tonase 0).
--
--  Iuran yang sudah tersimpan tidak berubah; ia diperlakukan sebagai angka
--  yang sudah diisi. P&L tidak berubah: COGS_PAGUYUBAN tetap
--  sum(paguyuban.total_bayar) (20250121_pnl_dari_operasional).
-- =====================================================================

create or replace function sinkron_paguyuban(p_transaksi_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update paguyuban p
     set tanggal = t.tanggal,
         tarif   = case when t.tonase > 0 then round(p.total_bayar / t.tonase, 2) else 0 end
    from transaksi_operasional t
   where t.id = p_transaksi_id and p.transaksi_id = t.id;
end;
$$;

comment on function sinkron_paguyuban(bigint) is
  'Tanggal dan tarif turunan (iuran ÷ tonase) iuran paguyuban satu truk. Iurannya sendiri diisi manual.';


-- ---------------------------------------------------------------------
--  Rincian Pembayaran Truk: p_truk menerima `paguyuban` (Rp) per truk.
--    kunci tidak ada  iuran tidak disentuh
--    null             belum diisi (baris paguyuban dihapus)
--    angka            iuran truk itu
-- ---------------------------------------------------------------------

create or replace function simpan_pembayaran_truk(p_rekap_id bigint, p_truk jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_id bigint;
  v_tonase numeric;
  v_ongkos numeric;
  v_paguyuban numeric;
begin
  perform 1 from operasional_rekap where id = p_rekap_id for update;
  if not found then
    raise exception 'Kegiatan tidak ditemukan, atau akun Anda tidak berwenang mengubahnya.';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_truk, '[]'::jsonb)) loop
    v_id     := (v_item->>'id')::bigint;
    v_tonase := coalesce((v_item->>'tonase')::numeric, 0);
    v_ongkos := coalesce((v_item->>'ongkos_angkut')::numeric, 0);

    update transaksi_operasional
       set ritase        = coalesce((v_item->>'ritase')::int, 0),
           tonase        = v_tonase,
           ongkos_angkut = v_ongkos,
           pendapatan    = v_tonase * v_ongkos,
           sangu_supir   = coalesce((v_item->>'sangu_supir')::numeric, 0),
           terpal        = (v_item->>'terpal')::numeric
     where id = v_id and operasional_rekap_id = p_rekap_id;
    if not found then
      raise exception 'Baris truk tidak ditemukan pada kegiatan ini, atau akun Anda tidak berwenang mengubahnya. Muat ulang halaman lalu coba lagi.';
    end if;

    if v_item ? 'paguyuban' then
      v_paguyuban := (v_item->>'paguyuban')::numeric;
      if v_paguyuban is null then
        delete from paguyuban where transaksi_id = v_id;
      elsif v_paguyuban < 0 then
        raise exception 'Iuran paguyuban tidak boleh negatif.';
      else
        insert into paguyuban (entity_id, transaksi_id, tanggal, tarif, total_bayar)
        select t.entity_id, t.id, t.tanggal, 0, v_paguyuban
          from transaksi_operasional t
         where t.id = v_id
        on conflict (transaksi_id) do update
           set total_bayar = excluded.total_bayar;
      end if;
    end if;

    perform sinkron_paguyuban(v_id);
  end loop;

  perform hitung_ulang_kegiatan(p_rekap_id);
end;
$$;

comment on function simpan_pembayaran_truk(bigint, jsonb) is
  'Rincian Pembayaran Truk: ritase, tonase, ongkos angkut, saku, terpal, dan iuran paguyuban per truk; beban rekanan dan honor telly dihitung ulang.';


-- ---------------------------------------------------------------------
--  Impor Excel: kolom Paguyuban (Rp) per truk.
-- ---------------------------------------------------------------------

create or replace function impor_kegiatan(p_entity_id uuid, p_kegiatan jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  k jsonb;
  v_id bigint;
  v_bayar jsonb;
  v_n int := 0;
begin
  perform impor_wajib_boleh_tulis(p_entity_id);
  for k in select * from jsonb_array_elements(coalesce(p_kegiatan, '[]'::jsonb)) loop
    if nullif(k->>'timpa_id', '') is not null then
      v_id := (k->>'timpa_id')::bigint;
      perform 1 from operasional_rekap where id = v_id and entity_id = p_entity_id;
      if not found then
        raise exception 'Kegiatan % yang akan ditimpa tidak ditemukan.', k->>'nama_kapal';
      end if;
      perform ubah_kegiatan(v_id, k->>'nama_kapal', (k->>'bulan')::int, (k->>'tahun')::int,
                            nullif(k->>'tanggal_input', '')::date, nullif(k->>'tanggal_kegiatan', '')::date,
                            nullif(k->>'tanggal_selesai', '')::date);
    else
      v_id := tambah_kegiatan(p_entity_id, k->>'nama_kapal', (k->>'bulan')::int, (k->>'tahun')::int,
                              nullif(k->>'tanggal_input', '')::date, nullif(k->>'tanggal_kegiatan', '')::date,
                              nullif(k->>'tanggal_selesai', '')::date, nullif(btrim(k->>'keterangan'), ''));
    end if;

    perform simpan_rincian_kegiatan(
      v_id, nullif(btrim(k->>'rute'), ''), nullif(k->>'operasional', '')::numeric,
      nullif(k->>'telly_id', '')::bigint, nullif(k->>'tanggal_input', '')::date,
      nullif(k->>'tanggal_kegiatan', '')::date, nullif(k->>'tanggal_selesai', '')::date,
      nullif(btrim(k->>'keterangan'), ''), coalesce(k->'truk', '[]'::jsonb)
    );

    -- Ongkos, saku, terpal, paguyuban per truk: the rows simpan_rincian_kegiatan just
    -- wrote, matched by nopol.
    -- A blank terpal stays NULL (belum diisi).
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', tr.id,
             'ritase', coalesce((t2->>'ritase')::int, 0),
             'tonase', coalesce((t2->>'tonase')::numeric, 0),
             'ongkos_angkut', coalesce(nullif(t2->>'ongkos_angkut', '')::numeric, 0),
             'sangu_supir', coalesce(nullif(t2->>'sangu_supir', '')::numeric, 0),
             'terpal', nullif(t2->>'terpal', '')::numeric)
           -- A template without the Paguyuban column leaves the iuran as it is.
           || case when t2 ? 'paguyuban'
                   then jsonb_build_object('paguyuban', nullif(t2->>'paguyuban', '')::numeric)
                   else '{}'::jsonb end), '[]'::jsonb)
      into v_bayar
      from transaksi_operasional tr
      join kendaraan kd on kd.id = tr.kendaraan_id
      join lateral (
        select el.value from jsonb_array_elements(coalesce(k->'truk', '[]'::jsonb)) el
         where upper(regexp_replace(btrim(el.value->>'nopol'), '\s+', ' ', 'g')) = upper(kd.nopol)
         limit 1
      ) m(t2) on true
     where tr.operasional_rekap_id = v_id;
    if jsonb_array_length(v_bayar) > 0 then
      perform simpan_pembayaran_truk(v_id, v_bayar);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
