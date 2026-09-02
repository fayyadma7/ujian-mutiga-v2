-- Nuke all koreksi_dan_submit overloads then recreate single bigint version
do $$
declare r record;
begin
  for r in select oid::regprocedure as proc from pg_proc where proname = 'koreksi_dan_submit'
  loop
    execute 'drop function if exists ' || r.proc || ' cascade';
  end loop;
end $$;

create or replace function koreksi_dan_submit(
    p_id_row          bigint,
    p_nama            text,
    p_kelas           text,
    p_mapel           text,
    p_jawaban         jsonb,
    p_pelanggaran     integer default 0,
    p_durasi          text default '-',
    p_status          text default 'SELESAI',
    p_log_pelanggaran text default null
)
returns jsonb
language plpgsql security definer
as $$
declare
    v_total_pg       integer := 0;
    v_benar_pg       integer := 0;
    v_skor_pg        integer := 0;
    v_essay_list     text[] := '{}';
    v_jawaban_pg_str text;
begin
    if p_id_row is null then
        return jsonb_build_object('success', false, 'error', 'p_id_row tidak boleh null');
    end if;
    if p_jawaban is null or jsonb_array_length(p_jawaban) = 0 then
        return jsonb_build_object('success', false, 'error', 'p_jawaban kosong');
    end if;

    select count(*) into v_total_pg
    from jsonb_array_elements(p_jawaban) as j
    where upper(trim(j->>'tipe')) = 'PG';

    select count(*) into v_benar_pg
    from jsonb_array_elements(p_jawaban) as j
    inner join bank_soal b on b.id = (j->>'id')::integer and b.mapel = p_mapel
    where upper(trim(j->>'tipe')) = 'PG'
      and upper(trim(b.kunci_jawaban)) = upper(trim(j->>'jawaban'));

    select array_agg(j->>'jawaban') into v_essay_list
    from jsonb_array_elements(p_jawaban) as j
    where upper(trim(j->>'tipe')) = 'ESSAY'
      and trim(j->>'jawaban') <> '';

    if v_total_pg > 0 then
        v_skor_pg := round((v_benar_pg::numeric / v_total_pg::numeric) * 100);
    end if;

    select '[' || coalesce(string_agg(
        jsonb_build_object('id', (j->>'id')::int, 'jawaban', j->>'jawaban', 'kunci', b.kunci_jawaban)::text,
        ',' order by (j->>'id')::int), '') || ']'
    into v_jawaban_pg_str
    from jsonb_array_elements(p_jawaban) as j
    left join bank_soal b on b.id = (j->>'id')::integer and b.mapel = p_mapel
    where upper(trim(j->>'tipe')) = 'PG';

    update jawaban_ujian
    set
        skor_pg         = v_skor_pg,
        jawaban_pg      = v_jawaban_pg_str,
        jawaban_essay   = array_to_string(v_essay_list, '|||'),
        pelanggaran     = greatest(coalesce(nullif(pelanggaran::text, ''), '0')::integer, p_pelanggaran),
        log_pelanggaran = case
            when p_log_pelanggaran is not null and length(trim(p_log_pelanggaran)) > 0
                 and length(trim(p_log_pelanggaran)) > coalesce(length(log_pelanggaran), 0)
            then p_log_pelanggaran
            else log_pelanggaran
        end,
        durasi          = p_durasi,
        status          = p_status
    where id = p_id_row;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Row jawaban_ujian tidak ditemukan');
    end if;

    return jsonb_build_object(
        'success', true,
        'skor', v_skor_pg,
        'benar', v_benar_pg,
        'total', v_total_pg
    );
end;
$$;

grant execute on function koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text) to anon;
grant execute on function koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text) to authenticated;
notify pgrst, 'reload schema';
