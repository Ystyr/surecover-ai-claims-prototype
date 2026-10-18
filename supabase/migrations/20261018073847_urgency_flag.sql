alter table public.inbound_messages
  add column urgency_noul double precision;

alter table public.inbound_messages
  add constraint inbound_messages_urgency_noul_range
  check (urgency_noul is null or (urgency_noul >= 0 and urgency_noul <= 1));
