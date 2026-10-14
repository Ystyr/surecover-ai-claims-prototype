-- Later code quotes this view. document_pages still stores every page,
-- including an unreadable page, so the gap stays visible.

create view public.quotable_pages
with (security_invoker = true) as
select
  id,
  document_id,
  page_number,
  text,
  text_source
from public.document_pages
where text_source in ('embedded', 'ocr');

revoke all on public.quotable_pages from public, anon;
grant select on public.quotable_pages to authenticated;
