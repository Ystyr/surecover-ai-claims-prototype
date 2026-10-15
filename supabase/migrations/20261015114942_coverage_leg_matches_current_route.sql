create or replace function private.assert_checks_agree(
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
  v_flight text;
  v_origin text;
  v_destination text;
  v_file_cited boolean := false;
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

  v_prefix := regexp_replace(p_fact_key, '#departure_date$', '');
  v_flight := private.effective_fact_value(p_claim_id, v_prefix || '#flight_number');
  v_origin := private.effective_fact_value(p_claim_id, v_prefix || '#origin');
  v_destination := private.effective_fact_value(p_claim_id, v_prefix || '#destination');
  v_file_cited := exists (
    select 1
    from jsonb_array_elements(coalesce(v_detail->'legs', '[]'::jsonb)) as leg
    where leg->'quote'->>'source_file' = p_source_file
  );

  if v_file_cited and (
    not exists (
      select 1
      from jsonb_array_elements(coalesce(v_detail->'legs', '[]'::jsonb)) as leg
      where leg->'quote'->>'source_file' = p_source_file
        and leg->'quote'->>'text' is not distinct from p_quote
        and leg->>'flight_number' is not distinct from v_flight
        and leg->>'origin' is not distinct from v_origin
        and leg->>'destination' is not distinct from v_destination
        and leg->>'departure_date' = p_value
    )
    or exists (
      select 1
      from jsonb_array_elements(coalesce(v_detail->'legs', '[]'::jsonb)) as leg
      where leg->'quote'->>'source_file' = p_source_file
        and leg->'quote'->>'text' is not distinct from p_quote
        and leg->>'flight_number' is not distinct from v_flight
        and leg->>'origin' is not distinct from v_origin
        and leg->>'destination' is not distinct from v_destination
        and leg->>'departure_date' is distinct from p_value
    )
  ) then
    raise exception 'value invalid';
  end if;

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

  if not v_file_cited
    and (
      not private.quote_cites_file(v_filing->'detail'->'revised_quote', p_source_file)
      or v_filing->'detail'->>'revised_arrival' is distinct from p_value
    )
  then
    raise exception 'value invalid';
  end if;
end;
$$;

revoke all on function private.assert_checks_agree(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
