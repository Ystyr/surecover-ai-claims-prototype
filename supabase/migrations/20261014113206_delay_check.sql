-- The fictional 6-hour rule is its own check. A short or unparseable
-- duration is not stored as a passing completeness row.

alter table public.policy_checks drop constraint policy_checks_name_check;

alter table public.policy_checks add constraint policy_checks_name_check check (
  check_name in (
    'completeness',
    'filing_deadline',
    'coverage',
    'claim_type',
    'consistency',
    'delay'
  )
);
