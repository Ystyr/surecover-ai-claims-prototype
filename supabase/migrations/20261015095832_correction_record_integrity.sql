-- The assigned officer writes a correction only through the private function.
-- Direct inserts into assessments, checks, and corrections are revoked.

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.canonical_fact_value(p_field text, p_value text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_text text;
  v_hours numeric;
  v_year int;
  v_month int;
  v_day int;
  v_date date;
  v_match text[];
begin
  v_text := btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g'));
  if v_text = '' then
    return null;
  end if;

  if p_field = 'flight_number' then
    v_text := upper(regexp_replace(v_text, '\s+', '', 'g'));
    if v_text ~ '^[A-Z]{2}[0-9]{2,4}$' then
      return v_text;
    end if;
    return null;
  end if;

  if p_field in ('origin', 'destination') then
    v_text := upper(regexp_replace(v_text, '\s+', '', 'g'));
    if v_text ~ '^[A-Z]{3}$' then
      return v_text;
    end if;
    return null;
  end if;

  if p_field = 'hours' then
    if v_text !~ '^[0-9]+(\.[0-9]+)?$' then
      return null;
    end if;
    v_hours := v_text::numeric;
    if v_hours < 0 then
      return null;
    end if;
    return v_hours::float8::text;
  end if;

  if p_field in ('departure_date', 'return_date') then
    if v_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      v_year := split_part(v_text, '-', 1)::int;
      v_month := split_part(v_text, '-', 2)::int;
      v_day := split_part(v_text, '-', 3)::int;
    else
      v_match := regexp_match(v_text, '([0-9]{1,2})[[:space:]]+([A-Za-z]+)[[:space:]]+([0-9]{4})');
      if v_match is null then
        return null;
      end if;
      v_day := v_match[1]::int;
      v_year := v_match[3]::int;
      v_month := case lower(v_match[2])
        when 'january' then 1
        when 'february' then 2
        when 'march' then 3
        when 'april' then 4
        when 'may' then 5
        when 'june' then 6
        when 'july' then 7
        when 'august' then 8
        when 'september' then 9
        when 'october' then 10
        when 'november' then 11
        when 'december' then 12
        else null
      end;
      if v_month is null then
        return null;
      end if;
    end if;
    begin
      v_date := make_date(v_year, v_month, v_day);
    exception
      when others then
        return null;
    end;
    return to_char(v_date, 'YYYY-MM-DD');
  end if;

  if p_field in ('claim_type', 'reason') then
    return v_text;
  end if;

  return null;
end;
$$;

revoke all on function private.canonical_fact_value(text, text) from public, anon, authenticated;

create function private.record_fact_correction(
  p_claim_id uuid,
  p_fact_key text,
  p_corrected_value text,
  p_rationale text,
  p_checks jsonb,
  p_baseline jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fact_id uuid;
  v_field text;
  v_effective text;
  v_canonical text;
  v_assessment_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_rationale is null or length(btrim(p_rationale)) = 0 then
    raise exception 'rationale required';
  end if;
  if p_corrected_value is null or length(btrim(p_corrected_value)) = 0 then
    raise exception 'value required';
  end if;
  if p_checks is null or jsonb_typeof(p_checks) <> 'array' or jsonb_array_length(p_checks) <> 6 then
    raise exception 'six checks required';
  end if;
  if (
    select count(*)
    from (
      select distinct entry->>'check_name' as check_name
      from jsonb_array_elements(p_checks) as entry
      where entry->>'outcome' in ('pass', 'fail', 'unknown')
        and entry->>'check_name' in (
          'completeness',
          'filing_deadline',
          'coverage',
          'claim_type',
          'consistency',
          'delay'
        )
        and jsonb_typeof(entry->'detail') = 'object'
    ) as names
  ) <> 6 then
    raise exception 'six checks required';
  end if;
  if p_baseline is null or jsonb_typeof(p_baseline) <> 'array' then
    raise exception 'stale correction';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(p_baseline)
  ) <> (
    select count(distinct entry->>'fact_key')
    from jsonb_array_elements(p_baseline) as entry
  ) then
    raise exception 'stale correction';
  end if;
  if not exists (
    select 1
    from public.claims
    where claims.id = p_claim_id
      and claims.assigned_officer_id = auth.uid()
  ) then
    raise exception 'fact not found';
  end if;

  perform 1
  from public.extracted_facts
  where claim_id = p_claim_id
  order by id
  for update;

  if exists (
    select 1
    from (
      select distinct on (extracted_facts.fact_key)
        extracted_facts.fact_key,
        fact_corrections.id as correction_id
      from public.extracted_facts
      left join public.fact_corrections
        on fact_corrections.fact_id = extracted_facts.id
      where extracted_facts.claim_id = p_claim_id
      order by extracted_facts.fact_key, fact_corrections.created_at desc nulls last, fact_corrections.id desc nulls last
    ) as latest
    full join (
      select
        entry->>'fact_key' as fact_key,
        nullif(entry->>'correction_id', '')::uuid as correction_id
      from jsonb_array_elements(p_baseline) as entry
    ) as given
      on given.fact_key = latest.fact_key
     and given.correction_id is not distinct from latest.correction_id
    where latest.fact_key is null
       or given.fact_key is null
  ) then
    raise exception 'stale correction';
  end if;

  select id, field
  into v_fact_id, v_field
  from public.extracted_facts
  where claim_id = p_claim_id
    and fact_key = p_fact_key;

  if v_fact_id is null then
    raise exception 'fact not found';
  end if;

  select corrected_value
  into v_effective
  from public.fact_corrections
  where fact_id = v_fact_id
  order by created_at desc, id desc
  limit 1;

  if v_effective is null then
    select original_value
    into v_effective
    from public.extracted_facts
    where id = v_fact_id;
  end if;

  v_canonical := private.canonical_fact_value(v_field, p_corrected_value);
  if v_canonical is null then
    raise exception 'value invalid';
  end if;
  if v_canonical = v_effective then
    raise exception 'value unchanged';
  end if;

  insert into public.assessments (claim_id, adapter)
  values (p_claim_id, 'fixture')
  returning id into v_assessment_id;

  insert into public.policy_checks (assessment_id, claim_id, check_name, outcome, detail)
  select
    v_assessment_id,
    p_claim_id,
    entry->>'check_name',
    entry->>'outcome',
    entry->'detail'
  from jsonb_array_elements(p_checks) as entry;

  insert into public.fact_corrections (fact_id, officer_id, rationale, corrected_value, assessment_id)
  values (v_fact_id, auth.uid(), btrim(p_rationale), v_canonical, v_assessment_id);

  return v_assessment_id;
end;
$$;

revoke all on function private.record_fact_correction(uuid, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function private.record_fact_correction(uuid, text, text, text, jsonb, jsonb) to authenticated;

drop function if exists public.record_fact_correction(uuid, text, text, text, jsonb);

create function public.record_fact_correction(
  p_claim_id uuid,
  p_fact_key text,
  p_corrected_value text,
  p_rationale text,
  p_checks jsonb,
  p_baseline jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.record_fact_correction(
    p_claim_id,
    p_fact_key,
    p_corrected_value,
    p_rationale,
    p_checks,
    p_baseline
  );
$$;

revoke all on function public.record_fact_correction(uuid, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.record_fact_correction(uuid, text, text, text, jsonb, jsonb) to authenticated;

drop policy if exists "officer inserts assigned corrections" on public.fact_corrections;
drop policy if exists "officer inserts assigned assessments" on public.assessments;
drop policy if exists "officer inserts assigned checks" on public.policy_checks;

revoke insert on public.fact_corrections, public.assessments, public.policy_checks from authenticated;
