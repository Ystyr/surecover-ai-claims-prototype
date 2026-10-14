# Backlog

A one-week, risk-first backlog for the interview prototype. Reorder as implementation constraints become clear.

## Must demonstrate

- [ ] Build a runnable Next.js App Router/TypeScript application with local Supabase for Postgres, Auth, RLS, and private Storage.
- [ ] Define claim, document, extracted-fact, evidence-reference, policy-check, workflow, message, and operator-decision contracts.
- [ ] Create a clearly labeled simplified policy configuration; include the stated 30-working-day deadline and required documents without inventing unverified policy terms.
- [ ] Implement Resend inbound email/webhook processing for the PDF claim form and supporting documents, plus deterministic outbound acknowledgments, status updates, and information-request replies. Persist provider ids/status and audit events; retain a simulation adapter for local use.
- [ ] Evaluate priority model Jev on labeled synthetic examples for document classification, semantic support questions, and evidence-span selection; record correctness, abstentions, grounding, and usage. Keep the fixture adapter for deterministic rehearsal.
- [ ] Classify document types and extract structured facts; preserve provenance and represent missing/ambiguous values explicitly.
- [ ] Implement deterministic completeness, deadline, coverage-period, claim-type, and consistency checks with `pass` / `fail` / `unknown` outcomes.
- [ ] Build the officer-centered queue and review workbench with actionable, evidence-linked findings and next actions.
- [ ] Allow an authorized officer to correct an extracted fact, preserve the original output and provenance, record the correction, and recompute affected checks.
- [ ] Support operator decisions: approve, reject, or request more information; record decision notes and timestamp.
- [ ] Prepare the complete, missing-document, and conflict/unreadable demo cases.
- [ ] Prepare a 20-minute presentation on architecture, model/tool choices, operations integration, edge cases, scale, and production risks.

## Important, scope permitting


- [ ] Keep credentials server-side and enforce claim/role-scoped access.
- [ ] Demonstrate access denial for a claim outside the operator's authorization.

## Explicitly out of scope unless time remains

- Production-scale email operations, payment/claim settlement, automated approval or rejection, full policy interpretation, broad historical retrieval, and production-grade operations/SLA infrastructure.










