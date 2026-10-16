# Backlog

A one-week, risk-first backlog for the interview prototype. Reorder as implementation constraints become clear.

## Must demonstrate

- [ ] Build a runnable Next.js App Router/TypeScript application on the hosted Supabase project SureCover Claims for Postgres, Auth, RLS, and private Storage.
- [ ] Define claim, document, extracted-fact, evidence-reference, policy-check, workflow, message, and operator-decision contracts.
- [ ] Create a clearly labeled simplified policy configuration; include the stated 30-working-day deadline and required documents without inventing unverified policy terms.
- [ ] Implement Resend inbound email/webhook processing for the PDF claim form and supporting documents, plus deterministic outbound acknowledgments, status updates, and information-request replies. Persist provider ids/status and audit events; retain a simulation adapter for local use.
- [ ] Evaluate priority model Jev on labeled synthetic examples for document classification, semantic support questions, and evidence-span selection; record correctness, abstentions, grounding, and usage. Keep the fixture adapter for deterministic rehearsal.
- [ ] Classify document types and extract structured facts; preserve provenance and represent missing/ambiguous values explicitly.
- [x] Implement deterministic completeness, deadline, coverage-period, claim-type, consistency, and delay checks with `pass` / `fail` / `unknown` outcomes. `npm run test:checks` covers the locked cases. `npm run assess:claim` stores the passing assessment for `CLM-DEMO-1001`, and `npm run verify:checks` shows it to officer A only.
- [x] Build the officer-centered queue and review workbench with actionable, evidence-linked findings and next actions. `npm run dev` signs an officer in and shows only that officer's claims. Officer A opens `CLM-DEMO-1001` and the latest six passing checks, quotes, and files. Officer B sees an empty queue and the same empty result on the claim URL. The recorded request leaves the claim `information requested`. Each demo file now has a stored Jev classification beside its fixture label. Resend stays later.
- [x] Allow an authorized officer to correct an extracted fact, preserve the original output and provenance, record the correction, and recompute affected checks. Officer A can correct every parsed fact on `CLM-DEMO-1001`. The original quote stays. The six checks are stored as a new assessment, and the earlier assessments stay. Officer B sees no facts and no corrections.
- [x] Support operator decisions: approve, reject, or request more information; record decision notes and timestamp. The assigned officer records one rationale against the latest assessment. Request sets `information requested` and leaves Approve and Reject available. Approve and Reject finish the claim. Approving while a check is `fail` or `unknown` names that check as its own words. A correction and a decision share the claim lock. Officer B sees no decision. The assigned officer records one simulated message for that request. Nothing is delivered.
- [ ] Prepare the complete, missing-document, and conflict/unreadable demo cases.
- [ ] Prepare a 20-minute presentation on architecture, model/tool choices, operations integration, edge cases, scale, and production risks.

## Important, scope permitting


- [ ] Keep credentials server-side and enforce claim/role-scoped access.
- [x] Demonstrate access denial for a claim outside the operator's authorization. `npm run verify:access` signs in as both officers: officer A reads `CLM-DEMO-1001` and its files, and officer B receives no rows and no file bytes.

## Explicitly out of scope unless time remains

- Production-scale email operations, payment/claim settlement, automated approval or rejection, full policy interpretation, broad historical retrieval, and production-grade operations/SLA infrastructure.










