# SureCover AI Claims Prototype

A one-week interview prototype for an AI-assisted airline flight-delay claims workflow for SureCover Travel Insurance (StarBridge Telecom).

## Project goals

Build an officer-centered workbench that turns traveler emails with a PDF claim form and supporting documents into review-ready flight-delay claims. The prototype uses Resend for inbound traveler email and deterministic acknowledgments, status updates, and specific information requests; local simulation remains available. It demonstrates context management, security, evidence-linked findings, deterministic workflow, and human decisions; it is not a production claims system.

## Assignment workflow

1. **Claim intake:** Receive a traveler email with a completed PDF claim form and supporting attachments through Resend; record deterministic acknowledgment and status/reply messages.
2. **Document processing:** Accept a completed claim form, scheduled and revised itineraries, boarding passes for affected flights, and an airline or handling-agent letter confirming the reason and duration of delay. Extract relevant information from unstructured documents.
3. **Classification and extraction:** Classify document types and relevant claim attributes, and extract structured facts with references to their source evidence. Prioritize Jev as the semantic model to evaluate: can it handle most semantic judgment while deterministic code controls workflow and a human resolves uncertainty? A generative LLM is a backup only if Jev cannot adequately handle a specific task.
4. **Completeness and policy checks:** Identify missing or inconsistent information. Apply explicit, versioned policy rules for claim type, coverage period, filing deadline, required documents, and consistency across evidence.
5. **Operations review:** Show original documents, extracted facts, evidence references, check results, uncertainty, and the available actions. An operator opens the claim workbench to see status, evidence, findings, history, and those actions, then approves, rejects, or requests more information. The screen does not rank the three actions.

## Design principles

- Keep model classification and extraction separate from deterministic policy validation.
- Represent each check as **pass**, **fail**, or **unknown**. A missing required document fails completeness and names the gap. Unreadable, ambiguous, or conflicting evidence, or a value that could not be established, stays **unknown**. Neither result is a silent rejection.
- Preserve provenance from every extracted fact and finding back to its document and, where practical, page or text location.
- Persist claim evidence, policy version, workflow state, unresolved issues, model/prompt versions, and audit events as structured data; do not rely on a long prompt as the system of record.
- Treat uploaded documents as untrusted evidence, not as instructions to the AI.
- Keep privileged credentials server-side, restrict access by role and claim, and give AI components only narrowly scoped tools.
- Keep final decisions under explicit operator control; send customer acknowledgments and status messages with deterministic templates and configured workflow events.
- Prefer a small, explainable implementation that can be completed and demonstrated within one week.

## Policy assumptions

The assignment states that a claim must be submitted within **30 working days after returning to Singapore**. It also requires a claim form, scheduled and revised itinerary, boarding pass for each affected flight, and an airline/handling-agent letter confirming delay reason and duration.

The actual insurance policy wording and other eligibility thresholds have not been provided. Any additional rules used in the prototype must be clearly labeled as fictional, configurable assumptions, not SureCover policy facts.

## Demonstration scenarios

- Complete submission with evidence that appears to satisfy the configured checks.
- Missing boarding pass, producing a completeness failure and a specific information-request email. A later matched reply returns that claim to needs review.
- Conflicting dates or unreadable evidence, producing an unknown or conflict finding for human review.
- Access-control demonstration: an operator cannot retrieve a claim or its documents outside their authorization.

## Initial architecture direction

Use Next.js App Router and TypeScript with the hosted Supabase project SureCover Claims for Postgres, Auth, row-level security, and private document storage. The traveler channel is email with a PDF claim form; use Resend inbound webhooks/outbound API and deterministic acknowledgments, status updates, and information requests, with a simulated local adapter. The operations workbench shows status, evidence, findings, history, and available actions.

Prioritize TypeSafe Jev behind a replaceable server-side adapter and evaluate whether it handles most semantic judgment. Keep workflow and policy checks deterministic, uncertainty visible, and decisions with the human operator. A generative LLM is a backup only if Jev cannot adequately handle a specific semantic task. A vector database is not needed for the initial structured workflow.

## Interview deliverable

- A working prototype that can be demonstrated end-to-end.
- A 20-minute presentation covering architecture, AI/model and tool choices, operations integration, edge cases, scalability, and production risks.
- A clear account of assumptions, limitations, and the distinction between AI assistance, policy checks, and human decisions.
