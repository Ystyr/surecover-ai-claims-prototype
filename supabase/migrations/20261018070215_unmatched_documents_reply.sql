alter table public.inbound_messages
  add column documents_noul double precision,
  add column documents_reply_subject text,
  add column documents_reply_body text,
  add column documents_reply_provider text,
  add column documents_reply_status text,
  add column documents_reply_provider_message_id text;

alter table public.inbound_messages
  add constraint inbound_messages_documents_noul_range
  check (documents_noul is null or (documents_noul >= 0 and documents_noul <= 1));

alter table public.inbound_messages
  add constraint inbound_messages_documents_reply_shape
  check (
    (
      documents_reply_subject is null
      and documents_reply_body is null
      and documents_reply_provider is null
      and documents_reply_status is null
      and documents_reply_provider_message_id is null
    )
    or (
      length(btrim(documents_reply_subject)) > 0
      and length(btrim(documents_reply_body)) > 0
      and documents_reply_provider in ('simulated', 'resend')
      and documents_reply_status in ('recorded', 'sent')
      and length(btrim(documents_reply_provider_message_id)) > 0
    )
  );

create policy "officer a reads unmatched mail"
on public.inbound_messages
for select
to authenticated
using (
  claim_id is null
  and exists (
    select 1
    from public.officers
    where officers.id = (select auth.uid())
      and officers.email = 'officer-a@example.com'
  )
);
