# Brainstorm Summary

## Purpose and constraints

Build a working AI prototype for the SureCover Travel Insurance airline flight-delay claims assignment, with a 20-minute presentation to the interview panel. The stated build window is one week. A complete production system is not expected; the assignment explicitly requires a working prototype, so a slide deck alone is insufficient.

Less than a week remains, and rehearsal needs a reserved block. The build is a sequence of steps with a stop line, not a seven-day calendar. The presentable prototype uses Resend for real traveler email with deterministic acknowledgments and status messages. A simulated adapter supports local runs and rehearsal fallback.

The panel will assess architecture, AI/model/tool choices, operations integration, edge-case handling, and production scalability and risks. Test whether priority candidate Jev handles most required semantic judgment; show the boundary between Jev, deterministic workflow code, and human resolution of uncertain cases. The automated tests from the policy, workflow, and access steps are the edge-case section of the talk.

## Assignment workflow

1. **Intake:** The traveler emails a completed PDF claim form and supporting documents through Resend; deterministic acknowledgment/status replies are sent. Local simulation remains available.
2. **Documents:** Process a completed claim form, scheduled and revised itinerary, boarding pass for every affected flight, and a letter from the airline or handling agent confirming delay reason and duration.
3. **Interpretation:** Extract relevant information from unstructured inputs; classify document types and relevant claim attributes.
4. **Validation:** Check completeness, claim type, coverage period, filing deadline, and consistency across documents. The assignment permits a simplified policy structure.
5. **Operations review:** Show the AI assessment and original submission. Let the operator make the final decision: approve, reject, or request more information.

Product-first framing and the officer-centered user journey are now documented in `ProductDesign.md`. This brainstorm remains the home for technical rationale and alternatives.

## Recommended product story

**Classification and extraction → structured claim context → deterministic policy checks → secure operations workflow → human decision**

Build one reliable, evidence-backed vertical slice. The system assists operations staff; it is not an autonomous adjudicator or a document chatbot.

Status and progress are part of that workflow. They live in persisted events and notification records. Email is a delivery channel for a notification that was already saved.

## Responsibility boundaries

- **Jev:** Classify each document and select among text spans that code has already found. Return a typed answer and its distribution. Jev reads text only. It does not read PDFs or images, write prose, call tools, or compare dates and durations.
- **Deterministic application code:** Extract page text, find candidate spans, copy the chosen span verbatim, parse dates and flight numbers, calculate working days, check required documents, run configured policy rules, reject a span that is not on the page, enforce authorization, manage workflow transitions, and build deterministic email messages from claim state.
- **Human operator:** Review evidence, resolve ambiguity, and decide whether to approve, reject, or request information. An authorized operator action or configured workflow event triggers a deterministic message template and Resend delivery; provider ids and outcomes are recorded. Use simulation for local runs.

A Jev label is not a policy determination. A policy check is not the final decision. Missing evidence must not be silently converted into a negative eligibility decision.

Jev is the priority semantic model to evaluate. A generative LLM is a backup only if Jev cannot handle a specific semantic task adequately; do not add it to the core without evidence of that gap.

## Jev

Prioritize TypeSafe Jev as the semantic classifier to evaluate. The contract is `POST /v1/systemone`: a state, a model id, and a map of questions. Official reference: [TypeSafe docs](https://docs.typesafe.ai/introduction/quickstart). Pin a versioned model id for the demo (`jev-1.13.0` unless the models page has moved). Do not pin the demo to the `jev-latest` alias.

Each question is one of:

- **Choice** — one label from criteria we supply, plus a probability for every option and a confidence summary.
- **Score** — a position on a rubric we supply. Not used for amounts, counts, or hours.
- **Noul** — the probability that a yes/no proposition is true. No separate confidence field.

One request per document. The state is that document's page text plus the candidate ids, passed as data. Document type and span choice share that state. Demo files are one or two pages. If a page must be shortened, keep each candidate, the surrounding lines, and the page id. Question wording lives in our code and is never built from the PDF. Independent questions share that request; a later question does not see an earlier answer. Ask every question the review screen might need, and let code ignore the ones that do not apply.

Question set **`jev-questions-demo-2026.1`**, stored with the policy version on every answer:

| Judgment | Question | What code does with it |
| --- | --- | --- |
| Document type | Choice: claim form, scheduled itinerary, revised itinerary, boarding pass, delay letter, `other` | Store the label, the full distribution, the model id, and the question-set version |
| Which span is the departure date, flight number, or stated delay | Choice over candidates a parser already found | Copy that span verbatim and parse it in code |
| Does this letter state a delay reason? | Noul | At or above 0.75 supports it. At or below 0.25 contradicts it. In between is `unknown` |
| Does this letter state a delay duration? | Noul | Same gates. The 6-hour comparison stays in code |
| Do two dates fall on the same day, and was the claim filed within 30 working days? | Not a Jev question | Code compares the parsed values |
| Is the delay at least 6 hours, and is the claim type flight delay? | Not a Jev question | Code applies `demo-2026.1` |
| Coverage period | Not a Jev question | Code compares parsed claim dates with the seeded `demo-2026.1` policy record. Flight documents do not supply the period, and the record is not placed in Jev state |

Abstain gates live in `jev-questions-demo-2026.1`. They are demo gates, not a measured accuracy rate. A choice is `unknown` when the label is `other` or the chosen option's probability is below 0.60. A noul is `unknown` when it is strictly between 0.25 and 0.75. A peaked distribution still does not approve the claim. The review screen shows the chosen label, the distribution, and the quoted span. That is the explanation. The fixture adapter records no provider token usage. Opening the review screen reuses the stored response. A deliberate reprocess writes a new assessment and keeps the previous one.

The API key stays on the server. Code checks that a chosen span actually occurs on the page before a fact is stored.

## What Jev makes unnecessary

These are excluded from the core path unless evaluation identifies a specific unmet need. The generative LLM is a backup if priority model Jev cannot handle a semantic task adequately.

- **A generative LLM in the core pipeline.** Jev is the priority for semantic classification and span selection; use a generative model only as a justified task-specific backup.
- **An LLM explanation or email polish.** Follow-up text comes from deterministic templates assembled from check results.
- **A vector store or general-purpose agent workflow for the core prototype.** Policy rules and claim facts are structured; retrieval does not decide coverage. LangGraph is also unnecessary unless the workflow becomes more complex. Docling is a parser option, not a classifier.
- **A generative LLM as a default second model.** First evaluate Jev on labeled examples; use fixture outputs for reliable rehearsal.

Text extraction stays necessary. An image-only file has no state to send, so the pipeline skips Jev and records `unknown`.

## Backup if Jev is unavailable

The fixture adapter implements the same interface: document type, choice, probabilities, model id, and question-set version. For the three demo bundles it returns the rehearsed answers. The timeline shows `adapter=fixture` and the reason. Policy checks, review, and the access-control case read stored facts and do not care which adapter wrote them.

| Failure | What the demo does |
| --- | --- |
| No key, auth error, or the API is down | Seeded claims use the fixture. A new upload is stored and marked `unknown`, with no invented facts. |
| Jev picks a span that is not in the page text | Drop that fact and mark it `unknown`. |
| The parser finds no date or flight-number candidates | Mark the field `unknown`. The operator still has the original file. |
| A demo file is mislabeled in rehearsal | Adjust the criteria, or pin that bundle to the fixture and say so in the talk. |
| The letter is not in English, or the PDF tells the system to ignore the rules and approve | The text stays in `state`. The outcome is `unknown` or a failed check. Nothing in the workflow can approve from the document. |

If Jev fails a specific semantic task, a generative LLM may be evaluated as a backup for that task. Any extracted fact still requires source-grounded evidence and human review where uncertain. Docling is the stage-1 parser: text PDFs become one item per line or table cell, a page with no text layer is OCR'd on its own, and images use OCR line boxes. A generative LLM is not the backup for parsing.

## Policy assumptions

Policy version **`demo-2026.1`**. Sample files and rules are built against this version.

From the assignment:

- The claim is submitted within **30 working days after returning to Singapore**. Dates are Asia/Singapore calendar dates. The return date is day 0 and is not counted. The next working day is day 1. Filing on the 30th working day is in time. Saturday, Sunday, and the Singapore public holidays listed in `demo-2026.1` are not working days. Received time, return date, and flight dates are stored scenario values. Opening the same claim on another calendar day leaves the deadline result unchanged.
- Required evidence: claim form, scheduled itinerary, revised itinerary, a boarding pass for each affected flight, and an airline or handling-agent letter stating delay reason and duration.

Fictional configuration, labeled as such because the real policy wording was not provided:

- Covered claim type is flight delay.
- Delay is at least 6 hours.
- **Coverage period comes from a seeded policy record** on `demo-2026.1`, not from a policy-schedule document and not from flight documents. The seeded dates are not the itinerary dates. Readable dates inside that period are `pass`. Readable dates outside it are `fail`. A missing record, or dates that cannot be read, are `unknown`.
- The complete claim returns to Singapore on Friday 7 August 2026 and is filed on Wednesday 12 August 2026. The window skips the weekend of 8–9 August and Monday 10 August 2026, which the policy list treats as National Day observed. The review screen shows the return date, the counted working days, and the deadline date. The itinerary is 1 August 2026 SIN–NRT and 7 August 2026 NRT–SIN. The seeded coverage period is 20 July 2026 through 31 August 2026. The letter states an 8-hour delay, which passes the fictional 6-hour rule. Both flights have boarding passes. The missing-pass case drops the 7 August pass and names that flight.

Rule outcomes:

- `pass`: sufficient, reliable evidence supports the condition.
- `fail`: sufficient, reliable evidence establishes the configured condition is not met.
- `unknown`: the input is unreadable, ambiguous, or materially conflicting, or a value could not be established. Absence of a required document fails completeness and is not stored as `unknown`.

Affected flights and boarding passes are records, not flat fields: flight number, date, origin, and destination. Each fact cites a document, page, and quoted span. Completeness is a set comparison: every affected flight has a matching boarding pass.

## Architecture direction

Stack:

- Next.js (App Router) and TypeScript for the Resend-backed traveler email flow and operator workbench. A simulated email adapter supports local development; no customer portal.
- Hosted Supabase project SureCover Claims for Postgres, Auth, row-level security, and private file storage. Docker is not required.
- Two operator accounts. Denial is a real read that returns nothing for an unassigned claim and its files. The service role stays on the server.
- Priority candidate Jev through the TypeSafe HTTP API, called only from the server and evaluated on labeled synthetic examples. The fixture adapter uses the same interface with no network call.

Stages:

1. Resend accepts the traveler email with the PDF claim form and attachments. The application verifies the signed webhook, records the `submitted` event, and sends deterministic acknowledgment, status, and information-request messages through Resend. A simulated adapter is the local fallback. A reply matched to an information-requested claim is assessed on that claim and returned to needs review.
2. Local Docling extraction. Text PDFs become one item per line or table cell. A PDF page with no text layer is OCR'd on its own. Images are read with English OCR line boxes. A blank page is marked empty. A page with ink but no extracted text is marked unreadable. A file with both extracted text and an unreadable page is `partial`. Later code quotes only `embedded` and `ocr` pages. An `unreadable` page is an unknown gap and is not sent as text. A `partial` file keeps its readable pages. An `empty` page means no ink. OCR lines keep a recognition score, and a score below 0.80 is marked for review.
3. Classification adapter. Evaluate priority model Jev against labeled `jev-questions-demo-2026.1` examples for each text-bearing document. The fixture adapter supplies the same answer shape for offline/rehearsal use or when Jev cannot be called. Both record adapter name, model id, and question-set version, and the raw response is stored beside the normalized facts.
4. Structured claim context: flights, facts, and evidence references. Code parses the selected spans and drops any span that is not on the page.
5. Deterministic completeness and policy checks under `demo-2026.1`.
6. Operations workbench, saved human decision, and claim timeline. The claim timeline shows inbound/outbound message events and provider delivery status; no customer portal.

The Jev evaluation should report semantic task quality, abstentions, evidence grounding, and provider usage. The acceptable quality bar remains open in `OpenQuestions.md` section 7.

## Context management

Treat persisted state as the source of truth, not an ever-growing prompt history. Keep distinct:

- **Evidence context:** original files, page text, document type, extracted facts, source passage and page, the raw classifier response, adapter name, model id, question-set version, and unresolved contradictions.
- **Policy context:** the exact policy version, holiday list, and configured rules used for this assessment.
- **Workflow context:** current stage, completed checks, outstanding tasks, prior operator decisions, notification records, and allowed next actions. Keep the full claim-scoped history for the operator and audit trail; expose only the minimum relevant history to any model task.

`workflow_events` and `notifications` are the status tracker: submitted, processing, needs review, information requested, approved, rejected. Keep an append-only, claim-scoped interaction timeline of submissions, processing events, requests, replies, and operator decisions. The operator can inspect that history; it is not all copied into model context. The receipt acknowledgment, status updates, and operator-requested missing-information message are deterministic templates sent through Resend and recorded with provider message ids and delivery status. A matched reply returns that claim to needs review with a new assessment beside the previous one. The simulated adapter supports local runs. Use the existing claim status/history in code to avoid duplicate follow-ups. If the Jev-backup LLM is ever used for a task, provide only that task input and the minimum claim context it needs.

For Jev, assemble one state per document: its page text and candidate ids. Do not send other claims or full interaction history, and do not send policy rules as instructions inside the document state. Keep policy rules in structured, versioned records with references to the source policy clauses. A vector database is not needed for the core demo. If a larger policy library later requires semantic search, use retrieval only to surface candidate clauses for review; deterministic policy code remains authoritative. Opening the review screen does not call Jev. A deliberate reprocess stores a new assessment beside the previous one, and the operator decision names the assessment it used.

## Services

| Role | Prototype |
| --- | --- |
| Postgres, Auth, row-level security, private storage | Hosted Supabase project SureCover Claims. Claims, files, operators, and the access denial all go through it. |
| PDF and image text | Local Docling. Text PDFs yield one item per line or table cell from the embedded text layer. A page with no text layer is read with English OCR. Images use English OCR line boxes. A blank page is marked empty. A page with ink but no extracted text is marked unreadable. A file with both extracted text and an unreadable page is `partial`. |
| Classifier | Jev (`POST /v1/systemone`) behind an adapter. The fixture adapter supports offline/rehearsal use and uses the same answer shape. |
| Email | Resend inbound webhooks and outbound API; deterministic templates, provider event history, and a simulated local adapter. |
| Traveler email | Resend inbox/outbox for the PDF claim form, attachments, acknowledgments, status updates, and information requests. |

Leave these for the production-risk slide: production-scale OCR for difficult phone photos, a queue for slow extraction, the insurer's core claims system, and payouts. A generative LLM is the backup only if Jev cannot adequately handle a specific semantic task; it is not a default prototype service.

## Security and operational risks

| Risk or concern | Prototype response |
| --- | --- |
| Document contains prompt injection or misleading content | The PDF text is Jev state, not question text. It cannot approve a claim, send a notification, or widen access. |
| Cross-claim data exposure | Use claim- and role-scoped authorization; keep files private; demonstrate denial for an unauthorized claim. The browser client never uses the service role. A Jev call receives one document's text. |
| Privileged key leaks to browser or model | Keep the Supabase service role and the TypeSafe API key on the server. Do not expose unrestricted SQL or a general database tool. |
| Jev label or selected span is wrong | Keep the raw response and the page quote. Drop a span that is not on the page. The operator can read the original. |
| Document has no text layer | Read it with English OCR. If that returns no text, report `unknown` and do not invent values. |
| Conflicting documents | Preserve each source value and flag the conflict rather than silently choosing one. |
| Policy is incomplete or ambiguous | Surface `unknown`. Coverage is judged only against the seeded policy record; a missing record or unreadable dates stay `unknown`. Keep assumptions visible and versioned. |
| Jev confidence is treated as approval | A peaked distribution can still be wrong. The `jev-questions-demo-2026.1` gates force `unknown` for `other`, a choice probability below 0.60, or a noul strictly between 0.25 and 0.75. The operator approves. |
| A message or decision runs because a model suggested it | Models have no tools. Only a configured application event or authorized operator action can initiate a deterministic message; final claim decisions remain human-controlled. |
| Jev is down during the interview | Seeded claims run through the fixture adapter. New uploads stay `unknown`. The required demo cases still run. |

## Demonstration scenarios

1. **Complete submission:** Arrives through Resend inbound email with the PDF form attached; the acknowledgment is sent to a controlled test recipient. Two affected flights, 1 August and 7 August 2026, each have a boarding pass. Facts agree, the 8-hour delay passes the fictional 6-hour rule, claim dates fall inside the seeded coverage period of 20 July–31 August 2026, and the filing check shows the 7 August return, the counted working days, and the deadline. The operator still records the final decision.
2. **Missing document:** Arrives through Resend inbound email. The 7 August boarding pass is absent. Completeness fails and names that flight. The officer requests the missing document, triggering a specific Resend email reply to the controlled test recipient.
3. **Conflict or unreadable evidence:** Dates disagree, or OCR returns no text. Checks show `unknown` and the case stays in review. An empty parse is not sent to Jev.
4. **Access control:** An operator reads another claim and its document and receives nothing.
5. **Fixture fallback:** The complete claim runs again with the fixture adapter. The timeline names the adapter and records no provider token usage.

The malicious-document example is a stretch goal. Its text would sit in Jev state. The workflow still cannot approve from that text. It waits until the required cases above are reliable.

## Build sequence

**1. Policy, fixtures, and expected results.** Lock `demo-2026.1`, including the counting convention, the 2026 holiday list, the seeded coverage period 20 July–31 August 2026, and the fictional 6-hour rule. Lock `jev-questions-demo-2026.1`, including the abstain gates. Build the synthetic bundles, with the complete claim filed on 12 August 2026 after a 7 August return, and write the check results each bundle must produce. Include the rehearsed classifier answers the fixture will return.

**2. System of record.** Tables for claims, documents, flights, extracted facts, policy checks, workflow events, and notifications. Store the raw classifier response, model id, and question-set version. Two operators, row-level security, private storage. The access-control test passes before any UI.

**3. Intake.** Resend inbound webhook receives the PDF claim form and attachments, creates the claim, records `submitted`, and sends a deterministic acknowledgment. The simulated adapter is the local fallback.

**4. Classify and extract.** Parse page text, find candidate spans, and call the adapter. Jev is the priority live candidate; evaluate its semantic task results before deciding whether the backup LLM is needed. The fixture is used when Jev cannot be called, and for any demo bundle pinned to it after rehearsal. Both write document types and facts with document, page, and quoted span.

**5. Checks.** Rules read stored facts and write `pass`, `fail`, or `unknown`. A missing boarding pass fails completeness. When the officer requests it, the app sends a deterministic Resend reply naming the gap; tests can use the simulated adapter. A date conflict or image-only file yields `unknown`. Nothing is auto-approved.

**6. Review and status.** The operator sees original files, facts, the Jev or fixture distribution, checks, and the timeline, then approves, rejects, or requests information. The deadline check shows the return date, counted working days, and deadline date. Each action appends an event and names the assessment it used. Opening the screen does not call the classifier. The claim timeline records inbound/outbound email ids and delivery states; there is no separate customer portal.

Stop after step 6 and rehearse the required cases, including the fixture run. Configure Resend and a controlled test address for the live email demonstration; keep the simulation adapter underneath. If a TypeSafe key is available, evaluate Jev on the labeled bundles and keep the fixture underneath.

**7. Email provider.** Resend handles inbound email and sends deterministic notifications. Keep the simulator available if a provider outage or configuration issue interrupts rehearsal.

## Testing

Automate the decisions. Walk the UI once per scenario.

- **Policy tests, from the step 1 fixtures.** Filing on 12 August 2026 after a 7 August return counts the weekend and 10 August holiday as non-working days. One day past the deadline fails. A missing 7 August boarding pass names that flight. Two boarding passes for the two affected flights pass. An 8-hour delay passes the fictional 6-hour rule, and a shorter parsed duration fails it. An unparseable duration is `unknown`. Dates that disagree, an unreadable file, coverage dates inside 20 July–31 August 2026, coverage dates outside that period, and a missing policy record or unreadable dates staying `unknown`.
- **Workflow tests.** A claim cannot reach approved without an operator decision. A request-information action sends a deterministic Resend message and records its provider id/status; tests can use the simulated adapter. The timeline is an ordered list of events with actor, channel on `submitted`, and policy version. The decision names the assessment it used. Opening the review screen does not create a classifier call.
- **Access tests.** The assigned operator can read the claim and its file. The other operator's query returns nothing.
- **Adapter contract.** Given the complete bundle, the fixture returns the expected document type, choice, probabilities, and a source span that occurs in the page text, and it records no provider tokens. A span that does not occur is dropped and the fact becomes `unknown`. An image-only file does not produce a Jev request. A choice below 0.60, an `other` label, or a noul strictly between 0.25 and 0.75 becomes `unknown`.
- **Jev rehearsal, when a key exists.** The same three bundles against `jev-questions-demo-2026.1`. Record the model id and distributions. A disagreement pins that bundle to the fixture for the talk.
- **Demo checklist, run by hand.** Resend inbound email with PDF form for the complete two-flight claim and the missing 7 August pass; controlled recipient receives the reply, conflicting or unreadable date, and the unauthorized open. Repeat the complete claim once with the fixture forced on.

## Open questions

See [OpenQuestions.md](OpenQuestions.md) for the consolidated unresolved decisions.
















