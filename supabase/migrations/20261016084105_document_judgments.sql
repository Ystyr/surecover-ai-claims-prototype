-- An officer can read a stored judgment only when the claim is assigned.
-- The service-role script writes the rows. Authenticated cannot.

create table public.document_judgments (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id),
  document_id uuid not null references public.claim_documents (id),
  adapter text not null,
  model text not null,
  question_set text not null,
  question text not null,
  instructions text not null,
  noul numeric not null,
  input_tokens integer,
  output_tokens integer,
  raw jsonb,
  created_at timestamptz not null default now(),
  constraint document_judgments_adapter_check check (adapter = 'jev'),
  constraint document_judgments_question_check check (question in ('delay_reason', 'delay_duration')),
  constraint document_judgments_noul_check check (noul >= 0 and noul <= 1),
  constraint document_judgments_document_question_key unique (document_id, question)
);

create index document_judgments_document_id_idx
on public.document_judgments (document_id, created_at desc, id desc);

alter table public.document_judgments enable row level security;

create policy "officer reads assigned judgments"
on public.document_judgments
for select
to authenticated
using (
  exists (
    select 1
    from public.claims
    where claims.id = document_judgments.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

revoke all on public.document_judgments from public, anon, authenticated;
grant select on public.document_judgments to authenticated;
