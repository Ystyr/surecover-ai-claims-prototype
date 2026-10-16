-- An officer can read a stored classification only when the claim is assigned.
-- The service-role script writes the rows. Authenticated cannot.

create table public.document_classifications (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id),
  document_id uuid not null references public.claim_documents (id),
  adapter text not null,
  model text,
  question_set text not null,
  label text not null,
  probability numeric not null,
  probabilities jsonb,
  confidence numeric,
  input_tokens integer,
  output_tokens integer,
  raw jsonb,
  created_at timestamptz not null default now(),
  constraint document_classifications_adapter_check check (adapter in ('fixture', 'jev')),
  constraint document_classifications_label_check check (
    label in (
      'claim_form',
      'scheduled_itinerary',
      'revised_itinerary',
      'boarding_pass',
      'delay_letter',
      'other'
    )
  ),
  constraint document_classifications_probability_check check (probability >= 0 and probability <= 1)
);

create index document_classifications_document_id_idx
on public.document_classifications (document_id, created_at desc, id desc);

alter table public.document_classifications enable row level security;

create policy "officer reads assigned classifications"
on public.document_classifications
for select
to authenticated
using (
  exists (
    select 1
    from public.claims
    where claims.id = document_classifications.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

revoke all on public.document_classifications from public, anon, authenticated;
grant select on public.document_classifications to authenticated;
