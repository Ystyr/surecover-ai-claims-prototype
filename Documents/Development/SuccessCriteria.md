# Success Criteria

This document turns the interview assignment and current project direction into observable outcomes. It is an acceptance guide for the prototype and presentation, not a production specification. The user outcome and experience are defined in `ProductDesign.md`; detailed technical rationale remains in `Brainstorm.md`, and current architectural choices are in `Direction.md`.

## 1. Assignment outcomes

### 1.1 Claim intake

**Objective:** Demonstrate how a flight-delay claim enters the workflow.

- A traveler can email the completed PDF claim form and supporting documents to the Resend inbound address.
- A publicly reachable Resend webhook verifies the inbound event, retrieves the PDF form and attachments, and records the message against a new claim.
- Intake creates the structured claim, assigns it to an officer, enters processing, and sends a deterministic receipt acknowledgment through Resend.
- The `submitted` event records `channel=email` and `provider=resend`; outbound acknowledgment, status, and information-request messages record provider message ids and delivery outcomes.
- The required document set is represented in the PDF form and attachment workflow: completed claim form, scheduled itinerary, revised itinerary, boarding pass for every affected flight, and airline/handling-agent letter stating delay reason and duration.
- Rehearsal uses Resend inbound email for complete and missing-document scenarios with the PDF claim form attached; use the simulation adapter only when provider setup is unavailable.

**Success looks like:** The audience can email a fictional claim, see the PDF form and attachments enter the claim through the webhook, and receive the acknowledgment/status message at a controlled test address.

### 1.2 Document classification and fact extraction

**Objective:** Show a purposeful AI classification layer for unstructured documents while preserving evidence.

- Documents are classified into the prototype's defined types, including an `other`/unknown path.
- Relevant claim facts are normalized into a typed structure.
- Every stored extracted fact points to its source document and page or text span.
- A selected span is copied from the parsed source text and verified against that text before it is stored.
- Missing, unreadable, unsupported, and ambiguous values remain explicit; the system does not invent a fact to fill a field.
- The Jev candidate and fixture path use the same application contract and identify which adapter/model produced each result.

**Success looks like:** A reviewer can inspect the evidence behind a value, correct an extraction when needed, and tell whether the result came from Jev or the fixture adapter.

### 1.3 Deterministic policy and completeness checks

**Objective:** Demonstrate that policy checks are explicit, repeatable, and separate from classifier output.

- The app checks the filing deadline of 30 working days after return to Singapore.
- `demo-2026.1` freezes the counting convention:
  - Dates are Asia/Singapore calendar dates.
  - The return date is day 0 and is not one of the 30 working days.
  - The next working day is day 1. Filing on the 30th working day is in time. The next working day after that is late.
  - Saturday, Sunday, and the Singapore public holidays listed in `demo-2026.1` are not working days.
- The deadline check shows the return date, the counted working days, and the deadline date. The complete claim's window includes one weekend and one holiday from that list, so the count is not a raw number of calendar days.
- Deadline, coverage, and delay checks use the received time, return date, flight dates, and holiday list stored with the claim and `demo-2026.1`. Opening the same claim on another calendar day leaves the result unchanged.
- The app checks the required documents, affected-flight/boarding-pass matching, configured claim type, configured coverage period, the fictional minimum delay, and consistency of relevant facts across documents.
- The fictional minimum delay is 6 hours. Code compares it with the parsed duration from the airline letter. A duration that cannot be parsed is `unknown`. The threshold is labeled as a demo assumption.
- Each check returns `pass`, `fail`, or `unknown`, with the observed value, required/configured value, evidence references, and explanation where relevant.
- `unknown` is used when the input is unreadable, ambiguous, or conflicting, or a value could not be established. It is not treated as a rejection. Absence of a required document fails completeness, names the gap, and is not stored as `unknown`.
- All invented policy details are labeled as fictional demo assumptions. The assignment-specified 30-working-day filing rule and document list are distinguished from those assumptions.
- A synthetic, versioned policy record supplies the demo coverage dates so the coverage-period check can be shown. Those dates are not the itinerary dates. Flight documents are not used to infer policy coverage dates.
- `jev-questions-demo-2026.1` freezes the abstain gates. They are demo gates, not a measured accuracy rate. A choice is `unknown` when the label is `other` or the chosen option's probability is below 0.60. A noul supports the proposition at or above 0.75, contradicts it at or below 0.25, and is `unknown` in between.

**Success looks like:** The same claim facts and policy version produce the same rule outcomes, independent of model wording. A reviewer can see why a check passed, failed, or remained unknown, including the dates used for the filing deadline.

### 1.4 Operations review and human decision

**Objective:** Make the human-in-the-loop step central to the working product.

- The review screen shows original evidence, extracted facts and provenance, classifier output, completeness findings, policy results, uncertainty, claim history, and the available actions. Findings are written in officer language. The classifier label, distribution, and quoted span are inspectable on the finding.
- The fictional 6-hour minimum, the seeded coverage period, and the holiday list are labeled as demo assumptions on the review screen. The assignment's filing window and required document list are not labeled as fictional.
- An authorized operator can correct an extracted fact while preserving the original extraction and source; affected checks are recomputed and the correction is recorded.
- An operator can approve, reject, or request more information. All three stay available and the screen does not rank one of them.
- Each action requires a rationale. An approval recorded while any check is `fail` or `unknown` names that check as its own words in the rationale. The action does not rewrite `unknown` as `fail`.
- The final action is made by an operator and recorded with actor, timestamp, notes, and the assessment and policy version reviewed.
- The queue lists only claims assigned to the signed-in officer. A claim assigned at intake appears there. Action needed is shown when the status is needs review. Check failed is shown when the latest assessment has a `fail` or `unknown` check, and that indicator does not change the status.
- The model cannot directly change a claim to approved/rejected or send a message.
- An officer request for information triggers a deterministic email through Resend that names the missing evidence, and the claim status becomes information requested. Receipt acknowledgments and configured status updates are also sent. No LLM writes these messages. Keep the simulated adapter for local runs.
- A later traveler reply matched to that claim is stored on the claim. The new documents are assessed, the previous assessment is kept, and the status returns to needs review. The reply does not approve or reject the claim.

**Success looks like:** The audience can see the operator review the evidence, understand the assessment, make a decision, and see that decision in the claim timeline.

## 2. Context management objectives

**Objective:** Demonstrate controlled, persistent context rather than relying on a growing conversation prompt.

- Claim state is stored in structured records and is the source of truth for workflow resumption.
- Evidence context, policy context, and workflow context are distinguishable.
- The applicable demo policy and question-set/model versions are recorded with each assessment.
- Raw classifier responses and normalized facts remain linked so the reviewer can inspect how an output was interpreted.
- Conflicting source values are preserved as separate evidence-backed facts until resolved; they are not silently overwritten.
- Each model call receives only the current claim document/context required for that question set; it receives no unrelated claim data.
- Workflow events record important transitions and operator actions in order.
- Opening the review screen, or opening the claim again after a restart, reads the stored assessment and does not call the classifier.
- A deliberate reprocess writes a new assessment and keeps the previous response. The operator decision records which assessment it used.

**Success looks like:** A processing step can be resumed from persisted state without asking a model to reconstruct prior decisions from chat history. Reopening the claim shows the same facts, checks, and timeline.

## 3. Token-efficiency objectives

**Objective:** Test whether Jev can handle most semantic judgment while code controls workflow and a human resolves uncertainty; use model calls only where interpretation is needed.

- Deterministic parsing and candidate generation happen before Jev is called. Evaluate Jev on labeled synthetic examples for document classification, semantic support questions, and evidence-span selection; report correctness, abstentions, grounding, and provider usage.
- Send one bounded request per text-bearing document with the independent questions required for that document; do not make separate calls for each small classification question.
- That request's state is the document's page text plus the candidate ids. Demo files are one or two pages. Document type and span choice share this state.
- Use concise question wording and a finite set of clear class labels/candidate spans. Include an `other`/abstention route where the taxonomy may be incomplete.
- Keep document/page identifiers attached to candidate spans so a selected result maps back to the exact evidence location.
- Do not ask Jev to compare dates, calculate working days, check coverage, determine document completeness, or perform other deterministic operations.
- Do not send complete claim histories, other customers' documents, irrelevant pages, policy text as document content, or files that have no usable text layer.
- Persist and reuse the response for that assessment instead of repeating the same request during UI rendering.
- Record provider usage metrics such as input/output token counts when available, alongside model and question-set version. Compare usage across the demo bundles rather than claiming an unsupported fixed token budget. The fixture adapter records no provider token usage.
- If context must be shortened, preserve the candidate span plus enough surrounding text to interpret it; do not truncate away the evidence needed to judge it.

**Success looks like:** The presentation reports whether Jev handled most tested semantic tasks, where it abstained or failed, and why deterministic workflow checks and human review remain. It explains call inputs and usage. A generative LLM is not added to the core unless evaluation shows a specific unmet need.

TypeSafe documents that questions within a System One request are evaluated independently against the same state, and recommends asking multiple relevant questions together. Extra questions and choice options still consume tokens. See the [TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart), [Choice reference](https://docs.typesafe.ai/primitives/choice), and [API reference](https://docs.typesafe.ai/api).

## 4. Security and privacy objectives

**Objective:** Make access boundaries visible and avoid sending or exposing claim data unnecessarily.

- Claim records and uploaded objects are private by default.
- Access is scoped by authenticated operator and claim assignment for both database rows and file objects.
- An assigned operator can read an assigned claim and its files; an unassigned operator cannot retrieve either.
- The access-control demonstration tests both claim lookup and document access, not only a hidden UI link.
- Browser code never contains the Supabase service-role key or TypeSafe API key.
- Read paths use the authenticated identity and RLS/storage policies where practical. Any privileged server-side operation performs an explicit authorization check before accessing a claim or file.
- Live Jev calls use synthetic demonstration documents. Real personal/travel data is not sent to an external model provider unless data handling, retention, and authorization have been reviewed.
- Uploaded text is treated as untrusted evidence. Embedded instructions cannot change policy, tools, authorization, or the operator decision.
- Model/classifier components have no unrestricted SQL, arbitrary file access, or side-effecting tools.
- The prototype sends deterministic acknowledgment, status, and information-request emails through Resend after authorized application events. The simulated adapter is available when provider configuration is unavailable.

**Success looks like:** The unauthorized-read scenario visibly returns no claim/file data, secrets remain server-side, and the audience can trace each boundary in the architecture.

## 5. Required demonstration cases

1. **Complete synthetic claim:** Submitted through the Resend inbound address with the PDF claim form attached; a deterministic acknowledgment reaches the controlled test recipient. Two affected flights each have a boarding pass. Facts agree, including a parsed delay of at least the fictional 6 hours. The filing window includes one weekend and one holiday from the `demo-2026.1` list, and the review screen shows the return date, counted working days, and deadline date. The seeded coverage period supports the check and is not the itinerary date range. The reviewer records a human decision.
2. **Missing boarding pass:** Submitted through the Resend inbound address. Completeness fails, the affected flight without a pass is named, and the operator information-request action triggers a specific email reply.
3. **Conflicting or unreadable evidence:** The conflicting values are visible with their sources, or the image-only document is marked unreadable/unknown. The claim remains for human review.
4. **Access control:** An operator not assigned to a claim attempts to read the claim and its file and receives no data.
5. **Fixture fallback:** The complete synthetic claim can be demonstrated with the fixture adapter if Jev is unavailable. The UI and timeline identify the adapter, and the fixture records no provider token usage.

## 6. Presentation objectives

The 20-minute presentation should:

- Walk through the working claim journey, not rely on slides alone.
- Present the Jev hypothesis and evaluation evidence; explain how Jev, deterministic code, and the operator have distinct responsibilities, and why a generative LLM may not be needed.
- Show one provenance trail from a source passage through an extracted fact and policy finding to the review screen.
- Explain persisted evidence/policy/workflow context and how a processing step resumes.
- Demonstrate at least one edge case and the unauthorized-access case.
- Show the filing-deadline check with its return date, counted working days, and deadline date.
- Explain token-efficiency choices, including bounded per-document context, batched independent questions, reuse of results, and usage recording.
- Label synthetic policy details and demo data clearly.
- Distinguish implemented behavior from production risks and future work.

## 7. Stop line and stretch goals

The prototype is ready for rehearsal when inbound and outbound Resend email works with fictional claim data and controlled recipients, the fixture-backed claim cases and access boundary work, the operator decision path works, and Jev has been evaluated on a representative labeled synthetic set. Report whether the semantic-judgment hypothesis held; keep the simulated email adapter for local runs and provider-failure fallback.

After that stop line, consider:

- Extending Jev evaluation to all sample bundles and rehearsing live provider behavior.
- Production-scale OCR for difficult phone photos and multi-page scans.
- Production-grade email operations, deliverability, monitoring, and retention controls.
- A malicious-document example, where embedded instructions sit in classifier state and still cannot approve the claim or change access.
- Production-scale mailbox ingestion, queues, insurer-core integration, payout, or broader retrieval infrastructure.
## 8. Non-goals

- Automated claim approval or rejection.
- Treating model confidence as a probability that a claim is correct.
- Presenting fictional thresholds as actual SureCover policy.
- Using a vector database or multi-agent framework without a demonstrated need.
- Processing real customer files through external services for the interview demo.
- Building production-grade email ingestion, claims-system integration, or settlement.










