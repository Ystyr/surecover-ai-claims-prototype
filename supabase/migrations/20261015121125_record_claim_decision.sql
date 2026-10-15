-- The assigned officer records a decision only through the private function.

create table public.claim_decisions (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id),
  officer_id uuid not null references public.officers (id),
  action text not null,
  rationale text not null,
  assessment_id uuid not null references public.assessments (id),
  policy_version text not null references public.policies (version),
  created_at timestamptz not null default now(),
  constraint claim_decisions_action_check check (action in ('request', 'approve', 'reject')),
  constraint claim_decisions_rationale_check check (length(btrim(rationale)) > 0)
);

create index claim_decisions_claim_id_idx on public.claim_decisions (claim_id, created_at desc, id desc);

alter table public.claim_decisions enable row level security;

create policy "officer reads assigned decisions"
on public.claim_decisions
for select
to authenticated
using (
  exists (
    select 1
    from public.claims
    where claims.id = claim_decisions.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

revoke all on public.claim_decisions from public, anon, authenticated;
grant select on public.claim_decisions to authenticated;

revoke insert, update, delete, truncate, trigger, references on public.claims from authenticated;

create function private.record_claim_decision(
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
      if v_label is null or position(lower(v_label) in lower(p_rationale)) = 0 then
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

revoke all on function private.record_claim_decision(uuid, text, text, uuid) from public, anon;
grant execute on function private.record_claim_decision(uuid, text, text, uuid) to authenticated;

create function public.record_claim_decision(
  p_claim_id uuid,
  p_action text,
  p_rationale text,
  p_assessment_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.record_claim_decision(
    p_claim_id,
    p_action,
    p_rationale,
    p_assessment_id
  );
$$;

revoke all on function public.record_claim_decision(uuid, text, text, uuid) from public, anon;
grant execute on function public.record_claim_decision(uuid, text, text, uuid) to authenticated;
