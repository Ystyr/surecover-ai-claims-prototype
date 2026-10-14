-- Stage 2 system of record.
-- Pages and items are the quotable text. The raw Docling document is not stored.
-- Quote only pages whose text_source is embedded or ocr.
-- An unreadable page is an unknown gap and is not sent as text.
-- A partial file keeps its readable pages.

create table public.officers (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null
);

create table public.policies (
  version text primary key,
  label text not null,
  coverage_start date not null,
  coverage_end date not null,
  public_holidays jsonb not null
);

create table public.claims (
  id uuid primary key,
  reference text not null unique,
  status text not null,
  policy_version text not null references public.policies (version),
  claimant_name text not null,
  policy_reference text not null,
  traveler_email text not null,
  return_date date not null,
  received_at timestamptz not null,
  assigned_officer_id uuid not null references public.officers (id),
  created_at timestamptz not null default now(),
  constraint claims_status_check check (
    status in (
      'submitted',
      'processing',
      'needs review',
      'information requested',
      'approved',
      'rejected'
    )
  )
);

create table public.claim_documents (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  source_file text not null,
  media_type text not null,
  storage_path text not null,
  text_source text not null,
  parser text not null,
  parser_version text not null,
  unique (claim_id, source_file),
  constraint claim_documents_text_source_check check (
    text_source in ('embedded', 'ocr', 'empty', 'unreadable', 'partial')
  )
);

create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.claim_documents (id) on delete cascade,
  page_number integer not null,
  text text not null,
  text_source text not null,
  unique (document_id, page_number),
  constraint document_pages_text_source_check check (
    text_source in ('embedded', 'ocr', 'empty', 'unreadable')
  )
);

create table public.document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.claim_documents (id) on delete cascade,
  page_number integer not null,
  item_index integer not null,
  text text not null,
  label text not null,
  bbox jsonb not null,
  confidence double precision,
  review boolean,
  unique (document_id, item_index)
);

create index claims_assigned_officer_id_idx on public.claims (assigned_officer_id);
create index claim_documents_claim_id_idx on public.claim_documents (claim_id);
create index document_pages_document_id_idx on public.document_pages (document_id);
create index document_items_document_id_idx on public.document_items (document_id);

alter table public.officers enable row level security;
alter table public.policies enable row level security;
alter table public.claims enable row level security;
alter table public.claim_documents enable row level security;
alter table public.document_pages enable row level security;
alter table public.document_items enable row level security;

grant select on public.officers, public.policies, public.claims, public.claim_documents, public.document_pages, public.document_items to authenticated;
revoke all on public.officers, public.policies, public.claims, public.claim_documents, public.document_pages, public.document_items from public, anon;

create policy "officer reads own profile"
on public.officers
for select
to authenticated
using (id = (select auth.uid()));

create policy "authenticated reads policy versions"
on public.policies
for select
to authenticated
using (true);

create policy "officer reads assigned claims"
on public.claims
for select
to authenticated
using (assigned_officer_id = (select auth.uid()));

create policy "officer reads assigned documents"
on public.claim_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.claims
    where claims.id = claim_documents.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create policy "officer reads assigned pages"
on public.document_pages
for select
to authenticated
using (
  exists (
    select 1
    from public.claim_documents
    join public.claims on claims.id = claim_documents.claim_id
    where claim_documents.id = document_pages.document_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create policy "officer reads assigned items"
on public.document_items
for select
to authenticated
using (
  exists (
    select 1
    from public.claim_documents
    join public.claims on claims.id = claim_documents.claim_id
    where claim_documents.id = document_items.document_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'claim-files',
  'claim-files',
  false,
  26214400,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/tiff', 'image/bmp', 'image/webp']
);

create policy "assigned officer reads claim files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'claim-files'
  and exists (
    select 1
    from public.claims
    where claims.id::text = (storage.foldername(name))[1]
      and claims.assigned_officer_id = (select auth.uid())
  )
);
