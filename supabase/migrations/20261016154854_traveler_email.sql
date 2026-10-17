-- A failed completeness gap is named in the request. An inbound email can be stored before its claim exists.

alter table public.claim_messages alter column decision_id drop not null;

alter table public.claim_messages drop constraint claim_messages_provider_check;
alter table public.claim_messages add constraint claim_messages_provider_check
  check (provider in ('simulated', 'resend'));

alter table public.claim_messages drop constraint claim_messages_status_check;
alter table public.claim_messages add constraint claim_messages_status_check
  check (status in ('recorded', 'sent'));

alter table public.claim_messages drop constraint claim_messages_provider_id_check;
alter table public.claim_messages add constraint claim_messages_provider_id_check
  check (
    (provider = 'simulated' and provider_message_id like 'simulated-%')
    or (provider = 'resend' and length(btrim(provider_message_id)) > 0)
  );

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
  v_gap_block text := '';
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

create or replace function private.mark_request_message_sent(p_message_id uuid, p_provider_message_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_message_id is null or p_provider_message_id is null or length(btrim(p_provider_message_id)) = 0 then
    raise exception 'message invalid';
  end if;

  update public.claim_messages
  set provider = 'resend',
      provider_message_id = btrim(p_provider_message_id),
      status = 'sent'
  where id = p_message_id
    and provider = 'simulated'
    and status = 'recorded'
    and decision_id is not null;

  if not found then
    raise exception 'message invalid';
  end if;
end;
$$;

revoke all on function private.mark_request_message_sent(uuid, text) from public, anon, authenticated;

create or replace function public.mark_request_message_sent(p_message_id uuid, p_provider_message_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.mark_request_message_sent(p_message_id, p_provider_message_id);
end;
$$;

revoke all on function public.mark_request_message_sent(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_request_message_sent(uuid, text) to service_role;

create table public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_email_id text not null unique,
  from_address text not null,
  subject text not null,
  claim_id uuid references public.claims (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint inbound_messages_provider_check check (provider in ('simulated', 'resend')),
  constraint inbound_messages_subject_check check (length(btrim(subject)) > 0),
  constraint inbound_messages_from_check check (length(btrim(from_address)) > 0)
);

create index inbound_messages_claim_id_idx on public.inbound_messages (claim_id);

alter table public.inbound_messages enable row level security;

create policy "officer reads assigned inbound mail"
on public.inbound_messages
for select
to authenticated
using (
  claim_id is not null
  and exists (
    select 1
    from public.claims
    where claims.id = inbound_messages.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

revoke all on public.inbound_messages from public, anon, authenticated;
grant select on public.inbound_messages to authenticated;
grant select, insert, update, delete on public.inbound_messages to service_role;
