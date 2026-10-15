-- Row security does not cover truncate. Leave select, and no other table write.
revoke update, delete, truncate, trigger, references
on public.assessments, public.policy_checks
from authenticated;
