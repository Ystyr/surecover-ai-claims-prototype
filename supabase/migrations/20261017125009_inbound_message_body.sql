alter table public.inbound_messages
  add column body text,
  add column unavailable_noul double precision;

alter table public.inbound_messages
  add constraint inbound_messages_unavailable_noul_range
  check (unavailable_noul is null or (unavailable_noul >= 0 and unavailable_noul <= 1));
