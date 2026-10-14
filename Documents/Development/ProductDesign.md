# Product Design

This document defines the user outcome and product experience that the prototype's AI, data, and workflow components must serve. It is a working product direction for a one-week interview prototype, not a production claims specification. Assignment requirements are distinguished from product choices and unvalidated assumptions.

Related documents:

- `Direction.md` records the current technical and system boundaries.
- `SuccessCriteria.md` defines observable prototype and presentation outcomes.
- `OpenQuestions.md` tracks unresolved choices and assumptions requiring confirmation.
- `Brainstorm.md` keeps design rationale and alternatives.

## Product intent

### Primary user and customer

The insurance operations officer is the primary user. The insurer's operations organization is the primary customer and beneficiary. Travelers submit claims and are secondary users. Operations managers are business stakeholders who need consistent handling, visibility, and confidence in the process.

The prototype centers on the officer's workbench. The traveler interacts through email and submits a PDF claim form with supporting documents. The product receives claim submissions by email and sends acknowledgment, relevant status updates, and specific follow-up messages through a real email provider. For this prototype, Resend is the preferred provider. Keep a simulated adapter for local development and rehearsal when provider configuration is unavailable.

### Problem statement

A traveler emails a PDF claim form and supporting documents. An officer must identify the documents, locate relevant facts, check that required evidence is present, compare values across documents, find applicable policy rules, assess what remains uncertain, and decide whether to progress, request information, approve, or reject. Repeating these steps manually consumes time and makes omissions and inconsistent handling more likely.

Some work is mechanical, such as checking for a required file or calculating a filing deadline. Other work involves interpretation, such as deciding whether a letter supports a stated delay or whether two differently formatted records refer to the same flight. Conflicting or ambiguous evidence requires human judgment.

### Product objective

**Turn a pile of submitted documents into a review-ready claim, with the evidence and unresolved questions organized for the officer.**

The product should reduce time spent gathering and rechecking facts so officers can focus on cases that need interpretation or judgment. It should make checks easier to understand and decisions easier to explain, without silently transferring decision authority to automation.

### User outcomes

The prototype centers on the officer workbench and uses Resend to demonstrate the traveler email exchange: submission, acknowledgment, status updates, and a specific information request. Manager analytics remain outside the prototype.

- **Operations officer:** Quickly understand the claim, inspect the evidence behind each finding, correct an extraction mistake, acknowledge what remains unresolved, and record a defensible decision.
- **Traveler:** Submit a PDF claim form and supporting documents by email; receive an acknowledgment, useful status updates, and a specific request if information is missing. The prototype uses Resend for this exchange, with a local simulation fallback.
- **Operations manager, in a later pilot:** See a consistent process, identify backlogs and common bottlenecks, and verify that automation findings and human decisions are traceable.

## Product principles

1. **Design around the officer's task.** Present a queue and claim workbench rather than making a chatbot the primary interface.
2. **Explain every finding.** State what was found, why it matters, and which actions remain available. A finding does not have to be resolvable inside the system.
3. **Show evidence with conclusions.** Link extracted facts and checks to the source document and relevant page or passage. Make it easy to inspect the original.
4. **Separate missing, negative, and uncertain.** Missing or conflicting evidence must not be presented as proof that a traveler is ineligible.
5. **Keep policy and decision authority explicit.** Application code evaluates configured rules; an authorized human makes the final approve or reject decision. The workbench labels fictional demo rules where the officer can see them.
6. **Make AI subordinate to the workflow.** Use classification and extraction to organize work and surface relevant evidence. Do not require officers or travelers to understand model internals to use the product.
7. **Preserve a traceable history.** Record sources, assessment versions, corrections, operator actions, requests, and decisions against the claim.
8. **Prove value before adding machinery.** Introduce models, retrieval, and orchestration only where they improve the defined user outcome.

## User journey

### 1. A claim arrives

A traveler emails a completed PDF claim form and supporting documents. The product acknowledges receipt and creates a claim reference. Resend accepts the inbound message. The application verifies the webhook, stores the PDF and attachments, and assigns the claim to an officer. A local simulated adapter supports development and rehearsals. The same path drives the rest of the claim workflow.

### 2. The system prepares the claim

The system identifies documents, extracts relevant facts, and checks required evidence. It associates findings with their source documents. The officer should be able to see what was found and what could not be established without opening every file from scratch.

### 3. The claim is assessed

Configured policy and consistency checks run against the claim facts and applicable policy version. Each check reports pass, fail, or unknown, with the reason and evidence. Unknown means the input is unreadable, ambiguous, or conflicting, or a value could not be established. It is not an implicit failure. Absence of a required document is enough to fail completeness. That failure names the gap and is not an eligibility conclusion.

### 4. The officer reviews and resolves

One workbench brings together claim details, evidence, extraction results, checks, discrepancies, history, and the available actions. The officer can inspect source files and correct an extracted fact. The correction preserves the original value and provenance, recomputes the affected deterministic checks, and keeps the prior assessment in history. It does not call the classifier again. Request missing information, approve, and reject all stay available. The workbench does not rank or recommend one of them. Material conflicts remain visible and are not silently overwritten by the system.

`unknown` is not a failure and it does not remove an action. Approving while any check is `fail` or `unknown` requires a rationale that names those results. A missing document stays a completeness finding. It is not presented as proof that the traveler is ineligible.

### 5. The outcome is recorded

The decision, rationale, actor, time, and assessment version are recorded in the claim history, and that history is visible on the workbench. The traveler receives appropriate acknowledgment and status messages, including a clear request describing missing evidence and a later status/outcome update. Messages use controlled templates and are triggered by application workflow events; an LLM is not needed to send status. The prototype sends these messages through Resend using controlled templates and records provider message identifiers and delivery events. A simulated adapter remains available for repeatable local runs.

## Core operations experience

### Queue

The queue lists only claims assigned to the signed-in officer. A new claim is assigned when it is created, so it has a queue to appear in. An unassigned claim does not appear. Opening it directly returns no claim and no file. How the two demo officer identities are seeded remains open in `OpenQuestions.md` section 8.

Each row shows the claim reference, submission time, status, a short summary, and an action-needed indicator. The prototype statuses are submitted, processing, needs review, information requested, approved, and rejected. **Action needed** means the status is needs review: the officer has something to resolve. Submitted and processing are not ready. Information requested is waiting on the traveler. A matched reply on that claim stores the new message and documents, runs a new assessment beside the previous one, and returns the status to needs review. Approved and rejected are finished. Do not claim to provide operational backlog analytics unless those measures are actually implemented.

### Claim workbench

Use a structured layout rather than a conversational interface as the primary review surface. The initial concept has four areas:

1. **Claim overview:** reference, intake channel, flight and submission summary, status, and whether action is needed.
2. **Findings and evidence:** required documents, extracted facts, check outcomes, discrepancies, and uncertainty. Each finding is written in officer language, links to its source, and can open the original document. The chosen classifier label, its distribution, and the quoted span stay on that finding as evidence of how the value was produced. The distribution is not a claim decision and it is not the primary text of the finding. The fictional 6-hour minimum, the seeded coverage period, and the holiday list are labeled as demo assumptions. The 30-working-day filing window and the required document list come from the assignment and are not labeled as fictional.
3. **Claim history:** intake channel, assessment versions, corrections, inbound replies, outbound messages, and decisions, each with actor and time. The decision records the assessment it used.
4. **Available actions:** correct a fact, request missing information, approve, or reject. All three decisions stay available together and are not ranked. Each requires a rationale. Approving while any check is `fail` or `unknown` requires that rationale to name those results. The recorded action stores the actor, time, rationale, and assessment version.

Which extracted fields an officer may correct, how a correction is validated, and the exact audit event remain open in `OpenQuestions.md` section 9. The product decision is that correction is supported. A correction does not erase the original extraction, and it does not choose a winner among conflicting sources.

The exact visual layout is open to iteration. This sketch is the missing-pass demonstration claim, not a separate scenario:

> **Fictional demonstration data · policy `demo-2026.1`**  
> **SC-0042 · Flight delay · Received by email · Submitted 12 Aug 2026**  
> **Needs review · Action needed**  
> **Flights:** 1 Aug SIN–NRT · 7 Aug NRT–SIN  
> **Boarding pass:** Missing for 7 Aug NRT–SIN · Completeness failed  
> **Delay:** 8 hours, airline letter · Meets the fictional 6-hour minimum · View source  
> **Coverage:** Inside the seeded period, 20 Jul–31 Aug 2026 · Demo assumption  
> **Filing:** Returned 7 Aug 2026 · Counted working days and deadline shown · Assignment rule  
> **Actions:** Request missing information · Approve · Reject

A missing pass is a completeness failure. It is not a finding that the traveler is ineligible. On another demonstration claim, a parsed duration below the fictional 6-hour minimum is a negative finding: the letter is readable and the configured condition is not met. Conflicting or unreadable evidence stays `unknown`. Request, Approve, and Reject stay available in each case. Any sample claim or values shown in the interface must be clearly identified as fictional demonstration data.

### Traveler email experience

Email is the traveler interface. There is no web form. The traveler submits the completed PDF claim form and supporting documents by email, receives an acknowledgment, and gets status updates at meaningful workflow milestones. If information is missing, an officer requests it and the system sends a specific templated message. A later reply that matches the claim is stored on that claim, not opened as a new one. The new documents are classified and extracted, affected checks are recomputed, and the new assessment is kept beside the previous one. The claim returns to needs review for the officer. Nothing in the reply approves or rejects the claim. For the prototype, use Resend for inbound and outbound email, deterministic templates, and claim-linked history. Verify inbound webhook signatures, deduplicate provider retries, and record send/delivery failures. Keep a simulated adapter for local runs and repeatable rehearsal. Do not build a separate customer portal. How a reply is matched to a claim remains open in `OpenQuestions.md` section 8.

## Role of AI and automation

AI is an internal capability that supports the workbench; it is not the product itself.

- Classification helps identify document type and route uncertain items for officer review.
- Extraction organizes relevant facts and retains provenance to the source.
- Deterministic checks compare values, verify completeness, and apply explicit demo-policy rules.
- The workbench states findings and uncertainty in officer language. Classifier label, distribution, and quoted span remain inspectable on the finding. They explain the classifier. They do not decide the claim.
- The model cannot define policy, make the final claim decision, send communications, or mutate workflow state.
- Every finding remains inspectable by an authorized officer. A correction applies to an extracted fact, is recorded as an operator action, and does not erase the original model output or source evidence.

Jev is the priority semantic model and the main hypothesis to test: can it handle most of the judgment needed to classify documents, assess whether they support relevant facts, and select evidence spans, while deterministic code controls workflow and officers resolve uncertain cases? Evaluate it on labeled synthetic documents, including correctness, abstention, evidence grounding, and token/use cost. A generative LLM is the backup plan only if Jev cannot adequately handle a specific semantic task. Keep that backup out of the core pipeline unless evaluation identifies the gap and its benefit justifies the added cost, privacy, and operational risk.

## Prototype scope

### Core vertical slice

- Resend-backed traveler email with a PDF claim form and supporting attachments; send acknowledgment and claim-linked status/reply messages from deterministic templates. Keep a simulated email adapter for local runs.
- Operations queue limited to claims assigned to the signed-in officer. Action needed means the status is needs review.
- Classification, structured extraction, completeness checks, cross-document discrepancy detection, and configured policy checks.
- Evidence-linked review workbench with original-file inspection.
- Officer correction of an extracted fact, preserving the original extraction and provenance; recompute affected deterministic checks and retain the prior assessment in history. The editable field set and audit-event contract are still open in `OpenQuestions.md` section 9.
- Real acknowledgment, status updates, and specific missing-information replies through Resend, recorded in claim history. A matched traveler reply stays on the existing claim, is assessed, and returns that claim to needs review. Test with fictional claim data and controlled recipient addresses; use the simulated adapter when external configuration is unavailable.
- Explicit human approve, reject, and request-information actions. All three stay available and are not ranked. Each requires a rationale. An approval that proceeds while a check is `fail` or `unknown` names those results. The action is stored in the claim history with the assessment version.
- Synthetic demonstration scenarios: complete, incomplete, and conflicting or ambiguous evidence.

The PDF form is a demonstration artifact, not a verified SureCover form. Resend is a prototype integration, not a production mail operations setup. Product details that depend on actual policy, real claim forms, or operator research must be labeled as assumptions.

### Deferred

- Production-grade mailbox operations, deliverability setup, and production email retention/compliance.
- Automated approval, rejection, or payment.
- Production policy interpretation or generalized policy-document retrieval.
- Vector database or OpenViking context service for the small synthetic corpus.
- Multi-agent orchestration, unrestricted agent tools, and a primary chatbot interface.
- Production-scale analytics, claims-system integration, OCR expansion, and SLA/queue infrastructure.

These may be revisited only when a validated user need justifies them and the core workflow remains demonstrable.

## Business value and measurement

The prototype demonstrates a plausible workflow; it does not prove quantified business impact. Do not claim a percentage time or error reduction without a measured baseline and evaluation.

A later pilot should compare a baseline with assisted handling and measure:

- **Handling time:** officer time spent per claim, with a consistent start/end definition.
- **Review completeness:** frequency of claims reopened because a required document or field was overlooked.
- **Extraction and classification quality:** labeled-set performance, especially document identification, missing-evidence detection, and material discrepancy detection.
- **Decision defensibility:** whether decisions have supporting evidence, applicable policy references, human approval, and a reconstructable history.
- **Operational flow:** queue age, time waiting for customer information, and common bottlenecks, interpreted with case mix and staffing context.
- **Customer effort:** avoidable follow-up count, response time, and clarity of requested information, once a suitable baseline can be collected.

For the interview prototype, show the workflow and propose this measurement plan. Establishing a business baseline requires access to real operational data and is outside the demo. Live email tests must use fictional claim data and controlled test recipients.

## Assumptions and validation needs

This design starts from the user's stated assumption that operations is the primary customer and the officer is the primary user. It is a useful prototype focus, not a conclusion validated through user research.

Before production decisions, validate with officers and managers:

- Which parts of claim preparation consume the most time and cause the most rework?
- Which finding and evidence formats support trust and fast review?
- Which extracted facts may an officer correct, and what authorization or second review is needed?
- What is the actual decision policy, escalation model, and required audit rationale?
- What queue states, assignment model, and operational metrics are already used?
- What customer language and follow-up channels are approved?
- What data handling, retention, model-provider, accessibility, and regulatory requirements apply?

Until answered, use synthetic data and make demo policy assumptions visible on the workbench, next to the fictional 6-hour minimum, the seeded coverage period, and the holiday list. Product design must not imply that the prototype represents actual SureCover policy or production operations.








