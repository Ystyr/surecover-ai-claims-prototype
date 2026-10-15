-- A decision and a fact correction both lock the claim before they write.
-- An approval names each failed or unresolved check as its own words.

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

  perform 1
  from public.claims
  where claims.id = p_claim_id
    and claims.assigned_officer_id = auth.uid()
  for update;

  if not found then
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

create or replace function private.record_claim_decision(
  p_claim_id uuid,
  p_action text,
  p_rationale text,
  p_assessment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_policy text;
  v_latest uuid;
  v_decision_id uuid;
  v_check record;
  v_label text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_action is null or p_action not in ('request', 'approve', 'reject') then
    raise exception 'decision invalid';
  end if;
  if p_rationale is null or length(btrim(p_rationale)) = 0 then
    raise exception 'rationale required';
  end if;

  select status, policy_version
  into v_status, v_policy
  from public.claims
  where id = p_claim_id
    and assigned_officer_id = auth.uid()
  for update;

  if v_status is null then
    raise exception 'claim not found';
  end if;
  if v_status in ('approved', 'rejected')
    or (p_action = 'request' and v_status = 'information requested')
    or v_status not in ('submitted', 'processing', 'needs review', 'information requested')
  then
    raise exception 'decision recorded';
  end if;

  select id
  into v_latest
  from public.assessments
  where claim_id = p_claim_id
  order by created_at desc, id desc
  limit 1;

  if v_latest is distinct from p_assessment_id then
    raise exception 'stale decision';
  end if;

  if p_action = 'approve' then
    for v_check in
      select check_name
      from public.policy_checks
      where assessment_id = p_assessment_id
        and claim_id = p_claim_id
        and outcome in ('fail', 'unknown')
    loop
      v_label := case v_check.check_name
        when 'completeness' then 'Completeness'
        when 'filing_deadline' then 'Filing deadline'
        when 'coverage' then 'Coverage'
        when 'claim_type' then 'Claim type'
        when 'consistency' then 'Consistency'
        when 'delay' then 'Delay'
        else null
      end;
      if v_label is null
        or lower(p_rationale) !~ ('(^|[^[:alnum:]_])' || lower(v_label) || '([^[:alnum:]_]|$)')
      then
        raise exception 'checks unnamed';
      end if;
    end loop;
  end if;

  insert into public.claim_decisions (claim_id, officer_id, action, rationale, assessment_id, policy_version)
  values (p_claim_id, auth.uid(), p_action, btrim(p_rationale), p_assessment_id, v_policy)
  returning id into v_decision_id;

  update public.claims
  set status = case p_action
    when 'request' then 'information requested'
    when 'approve' then 'approved'
    when 'reject' then 'rejected'
  end
  where id = p_claim_id;

  return v_decision_id;
end;
$$;
