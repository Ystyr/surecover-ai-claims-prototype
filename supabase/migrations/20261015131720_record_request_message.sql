-- The assigned officer records the simulated request message only through the private function.

create table public.claim_messages (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id),
  decision_id uuid not null unique references public.claim_decisions (id),
  officer_id uuid not null references public.officers (id),
  to_address text not null,
  subject text not null,
  body text not null,
  provider text not null,
  provider_message_id text not null,
  status text not null,
  created_at timestamptz not null default now(),
  constraint claim_messages_provider_check check (provider = 'simulated'),
  constraint claim_messages_status_check check (status = 'recorded'),
  constraint claim_messages_provider_id_check check (provider_message_id like 'simulated-%'),
  constraint claim_messages_subject_check check (length(btrim(subject)) > 0),
  constraint claim_messages_body_check check (length(btrim(body)) > 0)
);

create index claim_messages_claim_id_idx on public.claim_messages (claim_id, created_at desc, id desc);

alter table public.claim_messages enable row level security;

create policy "officer reads assigned messages"
on public.claim_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.claims
    where claims.id = claim_messages.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

revoke all on public.claim_messages from public, anon, authenticated;
grant select on public.claim_messages to authenticated;

create function private.record_request_message(p_decision_id uuid)
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

  v_subject := 'Information requested for ' || v_reference;
  v_body := 'Hello ' || v_claimant || ',' || chr(10) || chr(10)
    || 'We need more information to continue claim ' || v_reference || '.' || chr(10) || chr(10)
    || v_rationale || chr(10) || chr(10)
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

revoke all on function private.record_request_message(uuid) from public, anon;
grant execute on function private.record_request_message(uuid) to authenticated;

create function public.record_request_message(p_decision_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.record_request_message(p_decision_id);
$$;

revoke all on function public.record_request_message(uuid) from public, anon;
grant execute on function public.record_request_message(uuid) to authenticated;
