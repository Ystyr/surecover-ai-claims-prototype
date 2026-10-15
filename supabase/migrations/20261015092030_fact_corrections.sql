-- Extracted facts stay as parsed. A correction is a later event.
-- The assigned officer can insert one correction and the assessment it produces.
-- The officer cannot update or delete a fact, a correction, or an assessment.

create table public.extracted_facts (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  fact_key text not null,
  source_file text not null,
  document_id uuid references public.claim_documents (id),
  page_number integer,
  quote_text text,
  field text not null,
  leg_index integer,
  original_value text not null,
  unique (claim_id, fact_key),
  constraint extracted_facts_field_check check (
    field in (
      'flight_number',
      'departure_date',
      'origin',
      'destination',
      'return_date',
      'claim_type',
      'hours',
      'reason'
    )
  )
);

create table public.fact_corrections (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references public.extracted_facts (id),
  officer_id uuid not null references public.officers (id),
  rationale text not null,
  corrected_value text not null,
  assessment_id uuid not null references public.assessments (id),
  created_at timestamptz not null default now(),
  constraint fact_corrections_rationale_check check (length(btrim(rationale)) > 0),
  constraint fact_corrections_value_check check (length(btrim(corrected_value)) > 0)
);

create index extracted_facts_claim_id_idx on public.extracted_facts (claim_id);
create index fact_corrections_fact_id_idx on public.fact_corrections (fact_id, created_at);

alter table public.extracted_facts enable row level security;
alter table public.fact_corrections enable row level security;

revoke all on public.extracted_facts, public.fact_corrections from public, anon, authenticated;
grant select on public.extracted_facts, public.fact_corrections to authenticated;
grant insert on public.fact_corrections, public.assessments, public.policy_checks to authenticated;

create policy "officer reads assigned facts"
on public.extracted_facts
for select
to authenticated
using (
  exists (
    select 1
    from public.claims
    where claims.id = extracted_facts.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create policy "officer reads assigned corrections"
on public.fact_corrections
for select
to authenticated
using (
  exists (
    select 1
    from public.extracted_facts
    join public.claims on claims.id = extracted_facts.claim_id
    where extracted_facts.id = fact_corrections.fact_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create policy "officer inserts assigned corrections"
on public.fact_corrections
for insert
to authenticated
with check (
  officer_id = (select auth.uid())
  and exists (
    select 1
    from public.extracted_facts
    join public.claims on claims.id = extracted_facts.claim_id
    where extracted_facts.id = fact_corrections.fact_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create policy "officer inserts assigned assessments"
on public.assessments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.claims
    where claims.id = assessments.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create policy "officer inserts assigned checks"
on public.policy_checks
for insert
to authenticated
with check (
  exists (
    select 1
    from public.claims
    where claims.id = policy_checks.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create function public.record_fact_correction(
  p_claim_id uuid,
  p_fact_key text,
  p_corrected_value text,
  p_rationale text,
  p_checks jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_fact_id uuid;
  v_original text;
  v_effective text;
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

  select id, original_value
  into v_fact_id, v_original
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
    v_effective := v_original;
  end if;
  if btrim(p_corrected_value) = v_effective then
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
  values (v_fact_id, auth.uid(), btrim(p_rationale), btrim(p_corrected_value), v_assessment_id);

  return v_assessment_id;
end;
$$;

revoke all on function public.record_fact_correction(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.record_fact_correction(uuid, text, text, text, jsonb) to authenticated;
