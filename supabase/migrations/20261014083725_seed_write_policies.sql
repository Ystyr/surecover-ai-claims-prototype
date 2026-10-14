-- Temporary write policies used for one publishable-key load.
-- The following migration drops them. Officers stay read-only.

create policy "seed inserts documents"
on public.claim_documents
for insert
to authenticated
with check (
  exists (
    select 1
    from public.claims
    where claims.id = claim_documents.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create policy "seed deletes documents"
on public.claim_documents
for delete
to authenticated
using (
  exists (
    select 1
    from public.claims
    where claims.id = claim_documents.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create policy "seed inserts pages"
on public.document_pages
for insert
to authenticated
with check (
  exists (
    select 1
    from public.claim_documents
    join public.claims on claims.id = claim_documents.claim_id
    where claim_documents.id = document_pages.document_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create policy "seed deletes pages"
on public.document_pages
for delete
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

create policy "seed inserts items"
on public.document_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.claim_documents
    join public.claims on claims.id = claim_documents.claim_id
    where claim_documents.id = document_items.document_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create policy "seed deletes items"
on public.document_items
for delete
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

create policy "seed inserts claim files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'claim-files'
  and exists (
    select 1
    from public.claims
    where claims.id::text = (storage.foldername(name))[1]
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create policy "seed deletes claim files"
on storage.objects
for delete
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
