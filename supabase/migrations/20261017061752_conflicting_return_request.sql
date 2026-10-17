-- A filing check that keeps two different return dates names both of them. It does not pick one.

create or replace function private.record_request_message(p_decision_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim_id uuid;
  v_reference text;
  v_claimant text;
  v_email text;
  v_action text;
  v_rationale text;
  v_outcome text;
  v_detail jsonb;
  v_filing_outcome text;
  v_filing jsonb;
  v_gap_block text := '';
  v_date_line text := '';
  v_return text;
  v_arrival text;
  v_return_month int;
  v_arrival_month int;
  v_months text[] := array['January','February','March','April','May','June','July','August','September','October','November','December'];
  v_subject text;
  v_body text;
  v_message_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_decision_id is null then
    raise exception 'message invalid';
  end if;

  select claims.id, claims.reference, claims.claimant_name, claims.traveler_email, claim_decisions.action, claim_decisions.rationale
  into v_claim_id, v_reference, v_claimant, v_email, v_action, v_rationale
  from public.claims
  join public.claim_decisions on claim_decisions.claim_id = claims.id
  where claim_decisions.id = p_decision_id
    and claims.assigned_officer_id = auth.uid()
  for update of claims;

  if v_claim_id is null then
    raise exception 'claim not found';
  end if;
  if v_action is distinct from 'request' then
    raise exception 'message invalid';
  end if;
  if exists (
    select 1
    from public.claim_messages
    where decision_id = p_decision_id
  ) then
    raise exception 'message recorded';
  end if;

  select policy_checks.outcome, policy_checks.detail
  into v_outcome, v_detail
  from public.policy_checks
  join public.assessments on assessments.id = policy_checks.assessment_id
  where policy_checks.claim_id = v_claim_id
    and policy_checks.check_name = 'completeness'
  order by assessments.created_at desc, assessments.id desc
  limit 1;

  if v_outcome = 'fail' and jsonb_typeof(v_detail -> 'gaps') = 'array' then
    select coalesce(string_agg('The boarding pass for ' || gap.value || ' is not on file.', chr(10) order by gap.ordinality), '')
    into v_gap_block
    from jsonb_array_elements_text(v_detail -> 'gaps') with ordinality as gap(value, ordinality)
    where length(btrim(gap.value)) > 0;
  elsif v_outcome = 'unknown'
    and (v_detail ->> 'unclassified') = 'true'
    and v_detail ->> 'reason' = 'A file is present but its document type is not established.'
    and jsonb_typeof(v_detail -> 'gaps') = 'array' then
    select coalesce(string_agg('Please send a clearer photo of the boarding pass for ' || gap.value || '.', chr(10) order by gap.ordinality), '')
    into v_gap_block
    from jsonb_array_elements_text(v_detail -> 'gaps') with ordinality as gap(value, ordinality)
    where length(btrim(gap.value)) > 0;
  end if;

  select policy_checks.outcome, policy_checks.detail
  into v_filing_outcome, v_filing
  from public.policy_checks
  join public.assessments on assessments.id = policy_checks.assessment_id
  where policy_checks.claim_id = v_claim_id
    and policy_checks.check_name = 'filing_deadline'
  order by assessments.created_at desc, assessments.id desc
  limit 1;

  v_return := v_filing ->> 'return_date';
  v_arrival := v_filing ->> 'revised_arrival';
  if v_filing_outcome = 'unknown'
    and v_return ~ '^\d{4}-\d{2}-\d{2}$'
    and v_arrival ~ '^\d{4}-\d{2}-\d{2}$'
    and v_return is distinct from v_arrival
    and not (v_filing ? 'deadline') then
    v_return_month := split_part(v_return, '-', 2)::int;
    v_arrival_month := split_part(v_arrival, '-', 2)::int;
    if v_return_month between 1 and 12 and v_arrival_month between 1 and 12 then
      v_date_line := 'The form return date '
        || split_part(v_return, '-', 3)::int::text || ' ' || v_months[v_return_month] || ' ' || split_part(v_return, '-', 1)
        || ' disagrees with the revised Singapore arrival '
        || split_part(v_arrival, '-', 3)::int::text || ' ' || v_months[v_arrival_month] || ' ' || split_part(v_arrival, '-', 1)
        || '. Both dates stay visible.';
    end if;
  end if;

  if v_date_line <> '' then
    v_gap_block := case when v_gap_block <> '' then v_gap_block || chr(10) || v_date_line else v_date_line end;
  end if;

  v_subject := 'Information requested for ' || v_reference;
  v_body := 'Hello ' || v_claimant || ',' || chr(10) || chr(10)
    || 'We need more information to continue claim ' || v_reference || '.' || chr(10) || chr(10);
  if v_gap_block <> '' then
    v_body := v_body || v_gap_block || chr(10) || chr(10);
  end if;
  v_body := v_body || v_rationale || chr(10) || chr(10)
    || 'Fictional demonstration data. Not a SureCover policy document.';

  insert into public.claim_messages (
    claim_id,
    decision_id,
    officer_id,
    to_address,
    subject,
    body,
    provider,
    provider_message_id,
    status
  )
  values (
    v_claim_id,
    p_decision_id,
    auth.uid(),
    v_email,
    v_subject,
    v_body,
    'simulated',
    'simulated-' || gen_random_uuid()::text,
    'recorded'
  )
  returning id into v_message_id;

  return v_message_id;
exception
  when unique_violation then
    raise exception 'message recorded';
end;
$$;
