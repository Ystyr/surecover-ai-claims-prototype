-- An officer can read a stored span choice only when the claim is assigned.
-- The service-role script writes the rows. Authenticated cannot.

create table public.document_span_choices (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id),
  document_id uuid not null references public.claim_documents (id),
  adapter text not null,
  model text not null,
  question_set text not null,
  question text not null,
  instructions text not null,
  choice text not null,
  item_id uuid references public.document_items (id),
  quote text,
  probability numeric not null,
  probabilities jsonb,
  confidence numeric,
  input_tokens integer,
  output_tokens integer,
  raw jsonb,
  created_at timestamptz not null default now(),
  constraint document_span_choices_adapter_check check (adapter = 'jev'),
  constraint document_span_choices_question_check check (
    question in ('delay_reason_span', 'delay_duration_span')
  ),
  constraint document_span_choices_probability_check check (probability >= 0 and probability <= 1),
  constraint document_span_choices_document_question_key unique (document_id, question)
);

create index document_span_choices_document_id_idx
on public.document_span_choices (document_id, created_at desc, id desc);

alter table public.document_span_choices enable row level security;

create policy "officer reads assigned span choices"
on public.document_span_choices
for select
to authenticated
using (
  exists (
    select 1
    from public.claims
    where claims.id = document_span_choices.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

revoke all on public.document_span_choices from public, anon, authenticated;
grant select on public.document_span_choices to authenticated;
