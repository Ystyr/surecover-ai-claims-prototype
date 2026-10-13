# SureCover AI Claims Prototype

A one-week interview prototype for an AI-assisted airline flight-delay claims workflow for SureCover Travel Insurance (StarBridge Telecom).

## Project goals

Build a working vertical slice that demonstrates how AI can help operations staff process a claim from submission through human review. The prototype should show sound AI engineering, context management, security boundaries, and practical operations integration. It is a demonstration, not a production claims system.

## Assignment workflow

1. **Claim intake:** Provide a claim submission form and simulate receiving an email with attachments.
2. **Document processing:** Accept a completed claim form, scheduled and revised itineraries, boarding passes for affected flights, and an airline or handling-agent letter confirming the reason and duration of delay. Extract relevant information from unstructured documents.
3. **Classification and extraction:** Classify document types and relevant claim attributes, and extract structured facts with references to their source evidence. Jev may be evaluated as a classification provider, but no real Jev integration is assumed until its product and interface are verified.
4. **Completeness and policy checks:** Identify missing or inconsistent information. Apply explicit, versioned policy rules for claim type, coverage period, filing deadline, required documents, and consistency across evidence.
5. **Operations review:** Show original documents, extracted facts, evidence references, check results, uncertainties, and suggested follow-up. An operator makes the final decision to approve, reject, or request more information.

## Design principles

- Keep model classification and extraction separate from deterministic policy validation.
- Represent each check as **pass**, **fail**, or **unknown**. Missing, unreadable, ambiguous, or conflicting evidence should not be silently converted into a rejection.
- Preserve provenance from every extracted fact and finding back to its document and, where practical, page or text location.
- Persist claim evidence, policy version, workflow state, unresolved issues, model/prompt versions, and audit events as structured data; do not rely on a long prompt as the system of record.
- Treat uploaded documents as untrusted evidence, not as instructions to the AI.
- Keep privileged credentials server-side, restrict access by role and claim, and give AI components only narrowly scoped tools.
- Keep consequential side effects and final decisions under explicit operator control.
- Prefer a small, explainable implementation that can be completed and demonstrated within one week.

## Policy assumptions

The assignment states that a claim must be submitted within **30 working days after returning to Singapore**. It also requires a claim form, scheduled and revised itinerary, boarding pass for each affected flight, and an airline/handling-agent letter confirming delay reason and duration.

The actual insurance policy wording and other eligibility thresholds have not been provided. Any additional rules used in the prototype must be clearly labeled as fictional, configurable assumptions, not SureCover policy facts.

## Demonstration scenarios

- Complete submission with evidence that appears to satisfy the configured checks.
- Missing boarding pass, producing an incomplete status and suggested follow-up.
- Conflicting dates or unreadable evidence, producing an unknown or conflict finding for human review.
- Access-control demonstration: an operator cannot retrieve a claim or its documents outside their authorization.

## Initial architecture direction

Start with a small modular web application and trusted backend orchestration. Supabase is a candidate for Postgres, authentication, row-level security, and private document storage. The model/classifier should sit behind a replaceable adapter. A vector database is not required for the initial structured workflow.

Specific framework, model, and Jev integration choices remain open until implementation planning.

## Interview deliverable

- A working prototype that can be demonstrated end-to-end.
- A 20-minute presentation covering architecture, AI/model and tool choices, operations integration, edge cases, scalability, and production risks.
- A clear account of assumptions, limitations, and the distinction between AI assistance, policy checks, and human decisions.
