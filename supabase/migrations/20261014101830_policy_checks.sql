-- Assessments keep earlier results. A later run inserts a new assessment.
-- Officers can read an assessment only when the claim is assigned to them.

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  adapter text not null,
  created_at timestamptz not null default now()
);

create table public.policy_checks (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  claim_id uuid not null references public.claims (id) on delete cascade,
  check_name text not null,
  outcome text not null,
  detail jsonb not null,
  unique (assessment_id, check_name),
  constraint policy_checks_outcome_check check (outcome in ('pass', 'fail', 'unknown')),
  constraint policy_checks_name_check check (
    check_name in (
      'completeness',
      'filing_deadline',
      'coverage',
      'claim_type',
      'consistency'
    )
  )
);

create index assessments_claim_id_idx on public.assessments (claim_id, created_at);
create index policy_checks_claim_id_idx on public.policy_checks (claim_id);

alter table public.assessments enable row level security;
alter table public.policy_checks enable row level security;

grant select on public.assessments, public.policy_checks to authenticated;
revoke all on public.assessments, public.policy_checks from public, anon;

create policy "officer reads assigned assessments"
on public.assessments
for select
to authenticated
using (
  exists (
    select 1
    from public.claims
    where claims.id = assessments.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);

create policy "officer reads assigned checks"
on public.policy_checks
for select
to authenticated
using (
  exists (
    select 1
    from public.claims
    where claims.id = policy_checks.claim_id
      and claims.assigned_officer_id = (select auth.uid())
  )
);
