# Useful Links and Reference Findings

Research notes for the SureCover flight-delay claims prototype. These projects are references for patterns and components; none is an approved end-to-end solution for this assignment.

## Document parsing: Docling

**Project:** [docling-project/docling](https://github.com/docling-project/docling)

Docling is an open-source document processing toolkit. Its repository describes support for PDFs, images, OCR for scanned documents, structured document representations, and local execution. It is a promising reference or candidate for extracting text and structure from submitted claim forms, itineraries, boarding passes, and airline letters.

**Why it may help:**
- Gives us a practical starting point for text-based and scanned files.
- Structured output can help preserve layout and connect extracted values to source material.
- Local processing may be useful when handling sensitive claim documents.

**Risks / checks before adopting:**
- Test it against representative sample documents; do not assume OCR or field extraction will be accurate enough.
- Confirm the setup/runtime cost fits the one-week schedule.
- The parser is not the insurance classifier or policy engine. Keep classification, extraction validation, and policy checks as separate steps.

## Human review and resumable workflows: LangGraph

**Guide:** [LangChain documentation: Human-in-the-loop](https://github.com/langchain-ai/docs/blob/main/src/oss/langchain/human-in-the-loop.mdx)

The guide shows pausing a workflow for human review, persisting state across the pause, and resuming after the reviewer responds. This is useful for understanding a review gate and durable workflow state.

**Why it may help:**
- Makes pause/review/resume explicit instead of hiding review behind a generic pending status.
- Offers patterns for checkpointing state and separating tool actions that need approval.

**Risks / checks before adopting:**
- A full orchestration framework may be unnecessary for one short, mostly linear prototype workflow.
- The human review screen and saved operator decision are assignment requirements regardless of framework choice.
- Prefer a small persisted state machine unless LangGraph materially simplifies the implementation.

## Supabase access control: RLS example

**Guide:** [Supabase: RAG with permissions](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/ai/rag-with-permissions.mdx)

Although the guide is about retrieval-augmented generation, its useful lesson here is that database access should be enforced with row-level security tied to the authenticated user and document ownership/permissions.

**Why it may help:**
- Provides a concrete starting point for claim- and document-scoped access policies.
- Reinforces that authorization should not depend only on a frontend filter or a model instruction.

**Risks / checks before adopting:**
- Do not add embeddings or a vector store just because the example uses them; this workflow is structured and does not currently need semantic retrieval.
- Service-role credentials bypass ordinary RLS protections; privileged backend operations still need explicit authorization checks.
- Adapt the example to the chosen operator/claim assignment model and test that unauthorized documents are denied.

## Insurance workflow example: Meridian Claims

**Project:** [Aatequa-Ansari/insurance-claim-agent](https://github.com/Aatequa-Ansari/insurance-claim-agent)

This third-party project describes deterministic document/eligibility checks, LLM-written explanations, a LangGraph workflow, and human escalation. Its stated architecture is useful to compare with our separation of model interpretation, rules, and review.

**Why it may help:**
- Offers an insurance-oriented example of combining structured checks with narrative explanation.
- May provide ideas for workflow diagrams and reviewer-facing summaries.

**Risks / checks before adopting:**
- It is a third-party reference; inspect the actual code, license, dependencies, and behavior rather than relying on claims in the README.
- It includes broader features such as fraud detection and automated outcomes that are not needed here and could blur the human decision boundary.
- The domain and rules are not SureCover travel insurance terms.

## Medical claims example: ClaimGPT

**Project:** [dev-azhar/ClaimGPT](https://github.com/dev-azhar/ClaimGPT)

This project focuses on medical insurance claims, including OCR, payer rules, coding, and scan analysis. It may provide interface or document-workflow ideas but is a poor fit as a base for airline delay claims.

**Risks / checks before adopting:**
- Medical coding and health-claim logic do not transfer to travel-delay claims.
- Its broad architecture would likely expand scope and implementation risk.
- Treat it as an optional UI/workflow reference only.

## Recommended use for this prototype

1. Evaluate Docling on a small set of representative PDFs/images and retain only if it improves extraction without slowing the demo.
2. Apply the Supabase RLS concepts if Supabase is selected; include a concrete unauthorized-document denial case.
3. Borrow the pause/review/resume concept from LangGraph, but add the framework only if it simplifies the one-week implementation.
4. Inspect Meridian Claims for architectural ideas if useful, while keeping the prototype narrower and the final decision explicitly human.
5. Do not select Jev based on these references. The exact Jev product, interface, and suitability still need verification.

## Sources

- [Docling GitHub repository](https://github.com/docling-project/docling)
- [LangGraph human-in-the-loop guide](https://github.com/langchain-ai/docs/blob/main/src/oss/langchain/human-in-the-loop.mdx)
- [Supabase RAG with permissions guide](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/ai/rag-with-permissions.mdx)
- [Meridian Claims repository](https://github.com/Aatequa-Ansari/insurance-claim-agent)
- [ClaimGPT repository](https://github.com/dev-azhar/ClaimGPT)
## Email provider: Resend

Resend is the preferred prototype email provider because it supports both inbound and outbound email. Its inbound service accepts messages at a Resend-provided address or configured domain, emits an `email.received` webhook, and exposes attachment metadata/content through its API. Outbound messages are sent through its Email API. The webhook endpoint must be publicly reachable; outbound sender domains require verification for branded sending. Keep API credentials and webhook signing secrets server-side, verify signatures, make inbound processing idempotent, and record provider ids and delivery states. Use fictional claims and controlled test recipients.

- [Inbound email overview](https://resend.com/features/inbound)
- [Email API](https://resend.com/features/email-api)
- [Webhook overview](https://www.resend.com/features/webhooks)

The project should keep a provider adapter and a local simulated adapter so development and rehearsals do not depend on external email delivery.
