-- =====================================================================
--  Laporan P&L dari data operasional platform (diputuskan 13 Oktober 2026)
--
--  Sebelumnya Input Laporan menarik rekap bulanan lewat HTTP dari sistem
--  Laravel lama, dan hanya untuk ILJ. Data operasional yang diinput di
--  platform ini — termasuk seluruh data PT ILA — tidak pernah sampai ke
--  laporan keuangan. Keputusan pemilik sistem:
--
--    1. Sumber angka P&L untuk ILJ dan ILA adalah tabel operasional di
--       platform ini. Laravel tidak dipakai lagi untuk P&L.
--    2. Draft P&L dibuat dan diperbarui otomatis setiap kali data
--       operasional bulan itu berubah. Alur pengajuan dan persetujuan tidak
--       berubah: staf mengajukan, manajer keuangan/direksi menyetujui, dan
--       baru setelah itu angkanya masuk konsolidasi.
--
--  Rumus tiap pos sama dengan endpoint Laravel yang digantikannya
--  (docs/task/10-integrasi-operasional.md) dan dengan layar Laporan
--  Operasional platform (detail-kegiatan.ts, laporan-operasional.ts), supaya
--  angka P&L dapat dilacak ke layar yang dilihat admin:
--
--    REV_TAGIHAN     sum(laporan_pendapatan.total) bulan/tahun itu
--    COGS_PAJAK      sum(laporan_pendapatan.pajak)
--    COGS_REKANAN    sum(transaksi_operasional.pendapatan), bulan = tanggal
--    COGS_SAKU       per kegiatan: agregat truk bila > 0, kalau tidak rekap
--    COGS_TERPAL     aturan yang sama
--    COGS_OPS        sum(operasional_rekap.operasional)
--    COGS_TELLY      gaji_telly per kegiatan (dan per truk, data lama)
--    COGS_PAGUYUBAN  sum(paguyuban.total_bayar) lewat transaksi induknya
--    OPEX_*          pengeluaran per jenis + gaji admin bulanan, dipetakan
--                    lewat operational_expense_mapping; yang belum
--                    dipetakan masuk OPEX_LAIN, yang dipetakan "tidak
--                    ditarik" dilewati
--
--  Hanya periode berstatus draft yang diperbarui (invarian 5). Periode yang
--  sudah diajukan tidak disentuh; layar Input Laporan menunjukkan bila data
--  operasionalnya berubah sesudah itu.
--
--  Tidak ada tabel baru.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Biaya per jenis satu bulan, belum dipetakan
-- ---------------------------------------------------------------------
create or replace function biaya_operasional_per_jenis(p_entity_id uuid, p_periode date)
returns table (sumber text, jenis text, jumlah numeric, baris int)
language sql
stable
security invoker
set search_path = public
as $$
  select 'pengeluaran'::text, p.jenis, sum(p.jumlah), count(*)::int
    from pengeluaran p
   where p.entity_id = p_entity_id
     and p.tanggal >= p_periode
     and p.tanggal < (p_periode + interval '1 month')::date
   group by p.jenis
  union all
  -- Gaji admin bulanan: baris honor telly tanpa kegiatan dan tanpa truk.
  -- Bulannya dari created_at waktu Jakarta (simpan_gaji_admin, 20250116).
  select 'honor_telly'::text, 'Gaji Admin Bulanan'::text, sum(g.gaji_bersih), count(*)::int
    from gaji_telly g
   where g.entity_id = p_entity_id
     and g.operasional_rekap_id is null
     and g.transaksi_id is null
     and (g.created_at at time zone 'Asia/Jakarta')::date >= p_periode
     and (g.created_at at time zone 'Asia/Jakarta')::date < (p_periode + interval '1 month')::date
  having count(*) > 0;
$$;

-- ---------------------------------------------------------------------
--  Jenis biaya yang pernah tercatat, untuk layar Pemetaan Biaya
-- ---------------------------------------------------------------------
create or replace function jenis_biaya_operasional(p_entity_id uuid)
returns table (sumber text, jenis text, baris int, terakhir date)
language sql
stable
security invoker
set search_path = public
as $$
  select 'pengeluaran'::text, p.jenis, count(*)::int, max(p.tanggal)
    from pengeluaran p
   where p.entity_id = p_entity_id
   group by p.jenis
  union all
  select 'honor_telly'::text, 'Gaji Admin Bulanan'::text, count(*)::int,
         max((g.created_at at time zone 'Asia/Jakarta')::date)
    from gaji_telly g
   where g.entity_id = p_entity_id
     and g.operasional_rekap_id is null
     and g.transaksi_id is null
  having count(*) > 0;
$$;

-- ---------------------------------------------------------------------
--  Pos COGS dan pendapatan satu bulan
-- ---------------------------------------------------------------------
create or replace function rekap_pnl_operasional(p_entity_id uuid, p_periode date)
returns table (line_code text, amount numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select extract(month from p_periode)::int as bulan,
           extract(year from p_periode)::int  as tahun,
           p_periode                          as dari,
           (p_periode + interval '1 month')::date as sampai
  ),
  lp as (
    select coalesce(sum(l.total), 0) as total, coalesce(sum(l.pajak), 0) as pajak
      from laporan_pendapatan l, b
     where l.entity_id = p_entity_id and l.bulan = b.bulan and l.tahun = b.tahun
  ),
  trx as (
    select t.id, t.operasional_rekap_id, t.pendapatan, t.sangu_supir, t.terpal
      from transaksi_operasional t, b
     where t.entity_id = p_entity_id and t.tanggal >= b.dari and t.tanggal < b.sampai
  ),
  keg as (
    select r.id, r.sangu_supir, r.terpal, r.operasional
      from operasional_rekap r, b
     where r.entity_id = p_entity_id and r.bulan = b.bulan and r.tahun = b.tahun
  ),
  truk as (
    select operasional_rekap_id as id, sum(sangu_supir) as sangu, sum(terpal) as terpal
      from trx
     where operasional_rekap_id is not null
     group by operasional_rekap_id
  ),
  -- Satu angka per kegiatan: rincian truk bila > 0, kalau tidak isian rekap.
  biaya as (
    select coalesce(sum(case when coalesce(t.sangu, 0) > 0 then t.sangu else coalesce(k.sangu_supir, 0) end), 0) as saku,
           coalesce(sum(case when coalesce(t.terpal, 0) > 0 then t.terpal else coalesce(k.terpal, 0) end), 0) as terpal,
           coalesce(sum(coalesce(k.operasional, 0)), 0) as ops
      from keg k
      left join truk t on t.id = k.id
  )
  select 'REV_TAGIHAN'::text, lp.total from lp
  union all select 'COGS_PAJAK', lp.pajak from lp
  union all select 'COGS_REKANAN', coalesce((select sum(pendapatan) from trx), 0)
  union all select 'COGS_SAKU', biaya.saku from biaya
  union all select 'COGS_TERPAL', biaya.terpal from biaya
  union all select 'COGS_OPS', biaya.ops from biaya
  union all
  select 'COGS_TELLY', coalesce(sum(g.gaji_bersih), 0)
    from gaji_telly g
   where g.entity_id = p_entity_id
     and (g.operasional_rekap_id in (select id from keg)
          or (g.operasional_rekap_id is null and g.transaksi_id in (select id from trx)))
  union all
  select 'COGS_PAGUYUBAN', coalesce(sum(p.total_bayar), 0)
    from paguyuban p
   where p.transaksi_id in (select id from trx);
$$;

-- ---------------------------------------------------------------------
--  Semua pos satu bulan, biaya sudah dipetakan (sama dengan petakanBiaya)
-- ---------------------------------------------------------------------
create or replace function pnl_operasional_terpetakan(p_entity_id uuid, p_periode date)
returns table (line_code text, amount numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with biaya as (
    select b.jumlah,
           m.id is not null as dipetakan,
           m.line_code      as tujuan
      from biaya_operasional_per_jenis(p_entity_id, p_periode) b
      left join operational_expense_mapping m
        on m.entity_id = p_entity_id and m.source = b.sumber and m.jenis = b.jenis
  ),
  semua as (
    select r.line_code, r.amount from rekap_pnl_operasional(p_entity_id, p_periode) r
    -- Pos tujuan pemetaan selalu ada, nol berarti "sudah dihitung, nol".
    union all select 'OPEX_LAIN', 0
    union all
    select m.line_code, 0
      from operational_expense_mapping m
     where m.entity_id = p_entity_id and m.line_code is not null
    -- Belum dipetakan → OPEX_LAIN; dipetakan ke null = "tidak ditarik".
    union all select coalesce(biaya.tujuan, 'OPEX_LAIN'), biaya.jumlah from biaya where not dipetakan or tujuan is not null
  )
  select semua.line_code, round(sum(semua.amount), 2) from semua group by semua.line_code;
$$;

-- ---------------------------------------------------------------------
--  Entitas yang laporannya diisi dari modul Operasional
-- ---------------------------------------------------------------------
create or replace function entitas_operasional()
returns table (id uuid, code text, legal_name text, business_line text)
language sql
stable
security invoker
set search_path = public
as $$
  select e.id, e.code, e.legal_name, e.business_line::text
    from entities e
   where e.is_active
     and exists (
       select 1
         from report_templates t
         join report_template_lines l on l.template_id = t.id
        where t.business_line = e.business_line
          and t.is_active and l.is_active
          and l.line_code = 'COGS_REKANAN'
     )
   order by e.code;
$$;

-- ---------------------------------------------------------------------
--  Membuat/memperbarui draft satu bulan
-- ---------------------------------------------------------------------
create or replace function _segarkan_pnl_operasional(p_entity_id uuid, p_periode date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_periode  date := date_trunc('month', p_periode)::date;
  v_period   periods;
  v_template uuid;
  v_ada      boolean;
begin
  select exists (
    select 1 from pnl_operasional_terpetakan(p_entity_id, v_periode) x where x.amount <> 0
  ) into v_ada;

  select * into v_period from periods where entity_id = p_entity_id and period = v_periode;

  if not found then
    if not v_ada then
      return 'tanpa_data';
    end if;
    select t.id into v_template
      from report_templates t
      join entities e on e.business_line = t.business_line
     where e.id = p_entity_id and t.is_active
       and exists (select 1 from report_template_lines l
                    where l.template_id = t.id and l.is_active and l.line_code = 'COGS_REKANAN')
     order by t.version desc
     limit 1;
    if v_template is null then
      return 'tanpa_template';
    end if;
    insert into periods (entity_id, period, template_id, status)
    values (p_entity_id, v_periode, v_template, 'draft')
    returning * into v_period;
  elsif v_period.status <> 'draft' then
    -- Invarian 5: hanya draft yang berubah.
    return 'terkunci';
  elsif not v_ada
    and v_period.rejection_note is null
    and not exists (select 1 from report_lines
                     where period_id = v_period.id and (source <> 'operasional' or note is not null))
    and not exists (select 1 from lampiran_periode where period_id = v_period.id) then
    -- Draft yang isinya hanya angka operasional dan kini semuanya nol —
    -- misalnya kegiatannya dipindah ke bulan lain — tidak menyisakan
    -- laporan kosong. Ada isian manusia (baris manual, catatan, lampiran,
    -- riwayat penolakan) → tetap ada.
    delete from periods where id = v_period.id;
    return 'dihapus';
  end if;

  insert into report_lines (period_id, line_code, amount, source)
  select v_period.id, x.line_code, x.amount, 'operasional'
    from pnl_operasional_terpetakan(p_entity_id, v_periode) x
   where exists (select 1 from report_template_lines tl
                  where tl.template_id = v_period.template_id
                    and tl.line_code = x.line_code
                    and tl.is_active)
  on conflict (period_id, line_code) do update
     set amount = excluded.amount,
         source = excluded.source
   where report_lines.amount is distinct from excluded.amount
      or report_lines.source is distinct from excluded.source;

  return case when v_period.created_at >= now() then 'dibuat' else 'diperbarui' end;
end;
$$;

revoke all on function _segarkan_pnl_operasional(uuid, date) from public;

-- Dipanggil tombol "Segarkan dari Operasional" di Input Laporan.
create or replace function segarkan_pnl_operasional(p_entity_id uuid, p_periode date)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_entity_access(p_entity_id)
     or not (can_write_reports() or can_write_operational(p_entity_id)) then
    raise exception 'Akun Anda tidak berwenang memperbarui laporan entitas ini.';
  end if;
  return _segarkan_pnl_operasional(p_entity_id, p_periode);
end;
$$;

-- Untuk layar Input Laporan: angka yang dihitung sekarang dan biaya per
-- jenis beserta pemetaannya. Staf entitas tidak membaca tabel operasional
-- (RLS), tetapi ringkasan bulanan entitasnya sendiri memang yang ia isi ke
-- laporan — jadi fungsi ini definer dengan pemeriksaan akses entitas.
create or replace function info_pnl_operasional(p_entity_id uuid, p_periode date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_entity_access(p_entity_id) then
    raise exception 'Akun Anda tidak berwenang membaca laporan entitas ini.';
  end if;
  return jsonb_build_object(
    'terhitung', (
      select coalesce(jsonb_object_agg(x.line_code, x.amount::text), '{}'::jsonb)
        from pnl_operasional_terpetakan(p_entity_id, p_periode) x
    ),
    'biaya', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'sumber', b.sumber, 'jenis', b.jenis, 'jumlah', b.jumlah::text, 'baris', b.baris,
               'dipetakan', m.id is not null, 'line_code', m.line_code)
             order by b.jumlah desc), '[]'::jsonb)
        from biaya_operasional_per_jenis(p_entity_id, p_periode) b
        left join operational_expense_mapping m
          on m.entity_id = p_entity_id and m.source = b.sumber and m.jenis = b.jenis
    )
  );
end;
$$;

-- ---------------------------------------------------------------------
--  Otomatis: sekali per (entitas, bulan) per transaksi, saat commit
-- ---------------------------------------------------------------------
create or replace function pnl_tandai(p_entity_id uuid, p_periode date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kunci text;
  v_sudah text;
begin
  if p_entity_id is null or p_periode is null then
    return;
  end if;
  v_kunci := p_entity_id::text || '|' || date_trunc('month', p_periode)::date::text;
  v_sudah := coalesce(current_setting('imr.pnl_disegarkan', true), '');
  if position(v_kunci in v_sudah) > 0 then
    return;
  end if;
  perform set_config('imr.pnl_disegarkan', v_sudah || ';' || v_kunci, true);

  -- Laporan keuangan tidak boleh menggagalkan penyimpanan data operasional.
  -- Draft yang tertinggal diperbarui lagi oleh perubahan berikutnya atau
  -- tombol Segarkan di Input Laporan.
  begin
    perform _segarkan_pnl_operasional(p_entity_id, p_periode);
  exception when others then
    raise warning 'Draft P&L % % tidak diperbarui: %', p_entity_id, p_periode, sqlerrm;
  end;
end;
$$;

revoke all on function pnl_tandai(uuid, date) from public;

create or replace function pnl_bulan_baris(p_tabel text, r jsonb)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v date;
begin
  case p_tabel
    when 'transaksi_operasional', 'pengeluaran', 'paguyuban' then
      v := (r->>'tanggal')::date;
    when 'operasional_rekap', 'laporan_pendapatan' then
      v := make_date((r->>'tahun')::int, (r->>'bulan')::int, 1);
    when 'gaji_telly' then
      if r->>'operasional_rekap_id' is not null then
        select make_date(tahun, bulan, 1) into v from operasional_rekap where id = (r->>'operasional_rekap_id')::bigint;
      elsif r->>'transaksi_id' is not null then
        select tanggal into v from transaksi_operasional where id = (r->>'transaksi_id')::bigint;
      else
        v := ((r->>'created_at')::timestamptz at time zone 'Asia/Jakarta')::date;
      end if;
    else
      v := null;
  end case;
  return date_trunc('month', v)::date;
end;
$$;

revoke all on function pnl_bulan_baris(text, jsonb) from public;

create or replace function trg_pnl_operasional()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baru jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_lama jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
begin
  if v_baru is not null then
    perform pnl_tandai((v_baru->>'entity_id')::uuid, pnl_bulan_baris(tg_table_name, v_baru));
  end if;
  if v_lama is not null then
    perform pnl_tandai((v_lama->>'entity_id')::uuid, pnl_bulan_baris(tg_table_name, v_lama));
  end if;
  return null;
end;
$$;

-- Pemetaan biaya berubah → semua draft entitas itu dihitung ulang.
create or replace function trg_pnl_pemetaan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity uuid := coalesce(new.entity_id, old.entity_id);
  p record;
begin
  for p in select period from periods where entity_id = v_entity and status = 'draft' loop
    perform pnl_tandai(v_entity, p.period);
  end loop;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'transaksi_operasional', 'operasional_rekap', 'laporan_pendapatan',
    'pengeluaran', 'paguyuban', 'gaji_telly'
  ] loop
    -- Constraint trigger yang ditunda sampai commit: impor 500 baris
    -- menghitung ulang tiap bulan satu kali, dengan data yang sudah final.
    execute format(
      'create constraint trigger %I after insert or update or delete on %I
         deferrable initially deferred for each row execute function trg_pnl_operasional()',
      t || '_pnl', t);
  end loop;
end;
$$;

create constraint trigger operational_expense_mapping_pnl
  after insert or update or delete on operational_expense_mapping
  deferrable initially deferred
  for each row execute function trg_pnl_pemetaan();

-- ---------------------------------------------------------------------
--  Draft untuk bulan-bulan yang sudah punya data operasional
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select entity_id, date_trunc('month', tanggal)::date as periode from transaksi_operasional
    union select entity_id, make_date(tahun, bulan, 1) from operasional_rekap
    union select entity_id, make_date(tahun, bulan, 1) from laporan_pendapatan
    union select entity_id, date_trunc('month', tanggal)::date from pengeluaran
  loop
    perform _segarkan_pnl_operasional(r.entity_id, r.periode);
  end loop;
end;
$$;
