create function private.effective_fact_value(p_claim_id uuid, p_fact_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select corrections.corrected_value
      from public.fact_corrections as corrections
      join public.extracted_facts as facts on facts.id = corrections.fact_id
      where facts.claim_id = p_claim_id
        and facts.fact_key = p_fact_key
      order by corrections.created_at desc, corrections.id desc
      limit 1
    ),
    (
      select facts.original_value
      from public.extracted_facts as facts
      where facts.claim_id = p_claim_id
        and facts.fact_key = p_fact_key
    )
  );
$$;

create function private.quote_texts(p_quote jsonb)
returns text[]
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_quote) = 'array' then coalesce(
      (
        select array_agg(item->>'text')
        from jsonb_array_elements(p_quote) as item
      ),
      '{}'::text[]
    )
    when jsonb_typeof(p_quote) = 'object' then array[p_quote->>'text']
    else '{}'::text[]
  end;
$$;

create function private.quote_cites_file(p_quote jsonb, p_source_file text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_quote) = 'array' then exists (
      select 1
      from jsonb_array_elements(p_quote) as item
      where item->>'source_file' = p_source_file
    )
    when jsonb_typeof(p_quote) = 'object' then p_quote->>'source_file' = p_source_file
    else false
  end;
$$;

create function private.assert_checks_agree(
  p_claim_id uuid,
  p_fact_key text,
  p_field text,
  p_value text,
  p_source_file text,
  p_quote text,
  p_checks jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb;
  v_detail jsonb;
  v_hours numeric;
  v_norm text;
  v_prefix text;
  v_destination text;
  v_own_original text;
  v_all_agree boolean := true;
  v_originals text[] := '{}';
  v_quotes text[] := '{}';
  v_unresolved boolean;
  v_filing jsonb;
  v_texts text[];
  v_other record;
  v_other_destination text;
  v_other_effective text;
begin
  if p_field = 'hours' then
    select entry
    into v_check
    from jsonb_array_elements(p_checks) as entry
    where entry->>'check_name' = 'delay';

    v_detail := v_check->'detail';
    begin
      v_hours := (v_detail->>'hours')::numeric;
    exception
      when others then
        raise exception 'value invalid';
    end;

    if v_hours is distinct from p_value::numeric
      or v_check->>'outcome' is distinct from (case when v_hours >= 6 then 'pass' else 'fail' end)
      or (v_detail->'quote'->>'text') is distinct from p_quote
    then
      raise exception 'value invalid';
    end if;
    return;
  end if;

  if p_field = 'claim_type' then
    select entry
    into v_check
    from jsonb_array_elements(p_checks) as entry
    where entry->>'check_name' = 'claim_type';

    v_norm := lower(regexp_replace(replace(p_value, '_', ' '), '\s+', ' ', 'g'));
    if (v_check->'detail'->>'value') is distinct from p_value
      or (v_norm is distinct from 'flight delay' and v_check->>'outcome' is distinct from 'fail')
    then
      raise exception 'value invalid';
    end if;
    return;
  end if;

  if p_field <> 'departure_date' then
    return;
  end if;

  select entry->'detail'
  into v_detail
  from jsonb_array_elements(p_checks) as entry
  where entry->>'check_name' = 'coverage';

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_detail->'legs', '[]'::jsonb)) as leg
    where leg->>'flight_number' = split_part(p_fact_key, '#', 2)
      and leg->'quote'->>'source_file' = p_source_file
      and (p_quote is null or leg->'quote'->>'text' = p_quote)
      and leg->>'departure_date' is distinct from p_value
  ) then
    raise exception 'value invalid';
  end if;

  v_prefix := regexp_replace(p_fact_key, '#departure_date$', '');
  v_destination := private.effective_fact_value(p_claim_id, v_prefix || '#destination');
  if v_destination is distinct from 'SIN' then
    return;
  end if;

  select facts.original_value
  into v_own_original
  from public.extracted_facts as facts
  where facts.claim_id = p_claim_id
    and facts.fact_key = p_fact_key;

  v_originals := array[v_own_original];
  if p_quote is not null then
    v_quotes := array[p_quote];
  end if;

  for v_other in
    select facts.fact_key, facts.quote_text, facts.original_value
    from public.extracted_facts as facts
    where facts.claim_id = p_claim_id
      and facts.source_file = p_source_file
      and facts.field = 'departure_date'
      and facts.fact_key <> p_fact_key
  loop
    v_other_destination := private.effective_fact_value(
      p_claim_id,
      regexp_replace(v_other.fact_key, '#departure_date$', '') || '#destination'
    );
    if v_other_destination is distinct from 'SIN' then
      continue;
    end if;
    v_other_effective := private.effective_fact_value(p_claim_id, v_other.fact_key);
    if v_other_effective is distinct from p_value then
      v_all_agree := false;
    end if;
    v_originals := v_originals || v_other.original_value;
    if v_other.quote_text is not null then
      v_quotes := v_quotes || v_other.quote_text;
    end if;
  end loop;

  v_unresolved := not v_all_agree
    or (
      (select count(distinct original_date) from unnest(v_originals) as original_date) > 1
      and p_value = any(v_originals)
      and (select count(distinct quote_text) from unnest(v_quotes) as quote_text) > 1
    );

  select entry
  into v_filing
  from jsonb_array_elements(p_checks) as entry
  where entry->>'check_name' = 'filing_deadline';

  if v_unresolved then
    v_texts := private.quote_texts(v_filing->'detail'->'revised_quote');
    if v_filing->>'outcome' is distinct from 'unknown'
      or v_filing->'detail'->>'revised_arrival' is not null
      or exists (
        select 1
        from unnest(v_quotes) as needed
        where needed <> all(coalesce(v_texts, '{}'::text[]))
      )
    then
      raise exception 'value invalid';
    end if;
    return;
  end if;

  if private.quote_cites_file(v_filing->'detail'->'revised_quote', p_source_file)
    and v_filing->'detail'->>'revised_arrival' is not null
    and v_filing->'detail'->>'revised_arrival' is distinct from p_value
  then
    raise exception 'value invalid';
  end if;
end;
$$;

revoke all on function private.effective_fact_value(uuid, text) from public, anon, authenticated;
revoke all on function private.quote_texts(jsonb) from public, anon, authenticated;
revoke all on function private.quote_cites_file(jsonb, text) from public, anon, authenticated;
revoke all on function private.assert_checks_agree(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;

create or replace function private.record_fact_correction(
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
  v_source text;
  v_quote text;
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

  select id, field, source_file, quote_text
  into v_fact_id, v_field, v_source, v_quote
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

  perform private.assert_checks_agree(
    p_claim_id,
    p_fact_key,
    v_field,
    v_canonical,
    v_source,
    v_quote,
    p_checks
  );

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
