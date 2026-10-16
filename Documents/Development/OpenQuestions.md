# Open Questions

This file is the single working list of unresolved or not-yet-specified project decisions. Answers should be recorded here first, then reflected in `Direction.md` when they change the stable project direction and in `Backlog.md` when they change implementation work. `Brainstorm.md` keeps rationale and alternatives; it should point here rather than maintain a duplicate question list.

Items are grouped by when they need an answer. A question can remain open if the prototype can safely use the stated fallback.

## Resolved

### Dates and times are scenario values

Deadline, coverage, and delay checks evaluate the received timestamp, return date, flight dates, and holiday list stored with the claim and in `demo-2026.1`. The same stored claim produces the same result whenever it is opened. Reflected in `Direction.md`, `Brainstorm.md`, and `SuccessCriteria.md`.

### Retrieval and policy context

A vector database is out of scope for the current prototype. Keep the demo policy and rules structured, versioned, and directly addressable, with references to source clauses. If policy documents grow enough to need semantic retrieval later, retrieval may surface candidate clauses but must not make the policy decision.

### Jev abstention gates

The current demo gates are set at `0.60` for Choice and `0.25`/`0.75` for Noul in `jev-questions-demo-2026.1`. These are routing assumptions, not accuracy guarantees. The implementation will use them unless rehearsal evidence justifies a versioned change.

### Interaction history and model context

Persist a claim-scoped interaction/event history for audit and operator review. Jev receives only the current document state, not the full history or other claims. Application code uses relevant status/history to avoid duplicate follow-ups. If the Jev-backup LLM is ever used, provide only the specific task input and minimum claim context required; deterministic email templates remain the default. The exact event schema and transition details remain open in section 8.

### Product users, outcome, and review experience

The product is centered on the operations officer as primary user, with the traveler as submitting user and operations manager as business stakeholder. The target outcome is a review-ready claim with evidence and unresolved questions organized for the officer. The primary interface is a structured queue and claim workbench, not a chatbot. Findings should explain what was found, why it matters, and which actions remain available. The prototype demonstrates the journey and a measurement plan; it must not claim unmeasured business impact. These choices are documented in `ProductDesign.md`; production validation with officers and managers remains necessary.

The review experience should let an authorized officer correct an extraction error while preserving the original output and recording the correction. This resolves the product-level question of whether correction is supported. The editable field set, validation, and exact audit-event contract remain open in section 9.

### Queue, decisions, and workbench evidence

The queue lists only claims assigned to the signed-in officer. A new claim is assigned when it is created. Action needed means the status is needs review. The queue also shows Check failed when the latest assessment has a `fail` or `unknown` check, without changing that status. Request, approve, and reject stay available together and are not ranked. Each requires a rationale. Approving while a check is `fail` or `unknown` requires that rationale to name those results. A missing required document fails completeness and is not an eligibility finding. Claim history is part of the workbench. Classifier label, distribution, and quoted span are inspectable evidence on a finding, written in officer language first. Fictional demo rules are labeled on the workbench. Reflected in `ProductDesign.md`. How the two demo officer identities are seeded remains open in section 8.


### Traveler email channel and status communication

The traveler-facing channel is email. There is no web form. A traveler submits a PDF claim form and supporting documents, then receives a deterministic acknowledgment, status updates, and specific information requests. Resend is the preferred prototype provider for inbound webhooks and outbound messages. Keep the simulated adapter for local development and rehearsal fallback. A reply matched to a claim in information requested stays on that claim, is assessed beside the previous assessment, and returns the claim to needs review. Exact trigger points, template wording, provider setup, and the matching rule remain open in section 8.

### Jev semantic-judgment hypothesis

Prioritize Jev and test whether it can handle most semantic judgment (document classification, whether relevant facts are supported, and evidence-span selection), while deterministic code controls workflow and officers resolve uncertainty. A generative LLM is the backup only if Jev cannot adequately handle a specific semantic task and the benefit justifies the added cost, privacy, and operational risk. The evaluation acceptance bar is still open in section 7.

### Document parser

Docling's standard pipeline is the stage-1 local parser. Provenance items are individual text lines or table cells, and every box is stored in `BOTTOMLEFT` coordinates. Each page records its own `text_source`. A scanned page in a mixed PDF is OCR'd on its own. A blank page is `empty`. A page with ink but no extracted text is `unreadable`. A file that has both extracted text and an unreadable page is `partial`. Neither an empty nor an unreadable result means the facts are absent. Later code quotes only `embedded` and `ocr` pages. An `unreadable` page is an unknown gap and is not sent as text. A `partial` file keeps its readable pages. An `empty` page means no ink. Each OCR line keeps its recognition score, and a score below 0.80 is marked `review` without dropping the line. A corrupt, password-protected, unsupported, or oversized file raises instead of returning a parse. The vision-language pipeline and picture descriptions stay off. The application calls `parser/convert_document.py`. Docling Serve can host the same JSON contract later and is not part of stage 1. Recorded parses under `fixtures/parses/` are the rehearsal artifact. Reflected in `Direction.md`. Node.js, Supabase, the original-file viewer, and Resend setup remain open in section 10.

### Complete-claim fixture locks

Stage 1 freezes the complete-claim values and the rules those files are built against. The machine-readable record is `fixtures/expected/complete-claim.json`. These locks cover that bundle. Questions below stay open where they go beyond it.

1. **Fact contract.** Required facts are claimant name, policy reference, return date, and affected flights as records: flight number, local departure date, origin, and destination. The received instant and traveler address come from the inbound message. Dates are Asia/Singapore calendar dates. Flight numbers and IATA codes are uppercase with spaces removed. Delay duration is a number of hours parsed in code. Claim type is flight delay because this mailbox only accepts that submission. The check passes when a document is classified as a delay letter. It is `unknown` when that letter is missing, labeled `other`, or below the 0.60 gate. It fails when a readable field names a different claim type.
2. **Sources.** The claim form is the affected-flight set and the return date. The scheduled itinerary is the planned trip. The revised itinerary is the changed trip. The airline letter is the only source for delay reason and duration. When the form and another document disagree on a compared field, both values stay visible and that check is `unknown`.
3. **Matching.** A boarding pass matches an affected flight on normalized flight number plus local departure date. A route mismatch on an otherwise matching pass is `unknown`. Completeness fails when no document is established as the required type, and the finding names the missing flight. A file that is present but unclassified, or a span that is dropped, stays `unknown`. Coverage compares each affected leg's departure date with the seeded period 20 July 2026 through 31 August 2026. Any readable leg outside that period fails. An unreadable date, with no leg clearly outside, is `unknown`. Return to Singapore is the form return date. When a Singapore arrival on the revised itinerary differs from that date, the deadline check is `unknown`.
4. **Delay outcomes.** A parsed duration of at least 6 hours passes. A parsed duration under 6 hours fails. The under-6 test value is 3 hours. A duration that cannot be parsed, and a noul result at or below 0.25, are `unknown`. Any stated reason satisfies the assignment. The complete-claim letter states 8 hours and the reason "late inbound aircraft".
5. **Holiday list.** `demo-2026.1` freezes the Ministry of Manpower 2026 public-holiday list published on 16 June 2025. National Day is Sunday 9 August 2026. Monday 10 August 2026 is the gazetted holiday in lieu. For a Friday 7 August 2026 return, Tuesday 11 August is working day 1 and Wednesday 12 August is working day 2. Working day 30 is Monday 21 September 2026. The late sample is Tuesday 22 September 2026.
6. **Bundles.** The talk shows the complete two-flight claim, the claim missing the 7 August 2026 NRT–SIN pass, and one conflict where the form return date disagrees with the Singapore arrival. Image-only unreadable input, late filing, a 3-hour delay, an unparseable duration, departure outside the seeded coverage period, and a missing policy record are automated tests. Live Jev calls use these synthetic files only.

## Resolve before locking the fixtures

The complete-claim bundle is locked above. The questions in this section stay open where a later bundle or rule needs a wider answer.

### 1. Claim form and fact contract

Working assumption: the traveler emails a completed PDF claim form and supporting documents. The form carries a claimant and policy reference, a return date, and affected flights as records (flight number, date, origin, destination). Store the received timestamp and provider message id; use a provider-neutral `channel=email` and track `provider=resend` separately.

- Which further fields are required, and which of these are optional?
- What validation demonstrates a “fully completed” form when the employer did not provide its actual form template?
- What are the canonical data types and formats for flight number, date/time, origin/destination, delay duration, return date, policy reference, and received timestamp? Calendar dates use Asia/Singapore dates. A received instant is stored, then read as its Singapore calendar date for the deadline.
- For each important fact, what are the permitted source documents, and how are multiple source values represented? The emailed PDF claim form and another attachment can disagree. There is no separate web form. Conflicts stay visible. A source-priority rule has not been defined.
- Where does claim type come from: the emailed PDF claim form, the delay letter, or a fixed flight-delay submission? What observed value makes that check `fail` or `unknown`?
- Which fields are compared across which documents, what normalization treats two values as the same, and which mismatches are `unknown`? Include the claimant name against the passenger name on a boarding pass or itinerary.

### 2. Candidate spans and provenance contract

- How will deterministic parsing generate candidate spans for each field, especially delay reason and duration as well as dates and flight numbers?
- Which Jev question selects the exact supporting span for delay reason and duration? Current notes ask whether a letter states those facts. The review UI also needs an evidence quote.
- Will Jev receive a document's full parsed text, one page at a time, or bounded page text around candidate spans? Define how page IDs survive any truncation and how multi-page documents are handled. Demo files are one or two pages.
- What should happen when a selected span appears more than once, overlaps multiple fields, or parses differently depending on locale?
- When document type is `other` or the chosen option is below 0.60, or the only span for a field is dropped because it is not on the page, the fact is `unknown`. Does completeness then `fail` as a missing required document, or stay `unknown` because a file is present and its type or span is not established?

### 3. Document and flight matching

Working assumption: affected flights are records, and completeness means every affected flight has a matching boarding pass. The missing-pass story drops the 7 August NRT–SIN pass and names that flight. The complete-claim itinerary is 1 August 2026 SIN–NRT and 7 August 2026 NRT–SIN.

- What exact rule matches a boarding pass to an affected flight (for example, normalized flight number plus local departure date, with route as supporting evidence)?
- Which list is the affected-flight set when the form, the scheduled itinerary, and the revised itinerary disagree? What is stored when the revised itinerary adds or drops a leg?
- How are codeshares, duplicate passes, connecting legs, or a boarding pass with a slightly different flight or date represented?
- What does the scheduled itinerary contribute, and what does the revised itinerary contribute? The 6-hour rule reads the airline letter. Is the time difference between the two itineraries its own consistency check? What does each check return when the letter states a delay and the itineraries do not, or the reverse?
- For a multi-flight claim, is the coverage-period check evaluated for each affected leg, and what aggregate result applies if only some legs fall within coverage?
- Which date on a leg is compared with the seeded coverage period: scheduled departure, revised departure, arrival, or the return date? The complete-claim window is 20 July 2026 through 31 August 2026, and those dates are the policy record, separate from the itinerary. What exact dates should the outside-coverage case use?
- Does the policy reference on the form have to match the seeded `demo-2026.1` record, or does every claim use that record? A missing policy record stays `unknown`.
- How is return to Singapore established: the form return date, the last arrival in Singapore, or agreement between them? What is the result when no leg arrives in Singapore, or the form date and the Singapore arrival differ? The complete-claim return date is Friday 7 August 2026.

### 4. Delay reason, duration, and other check outcomes

Working assumption: a missing required document fails completeness. A duration that cannot be parsed is `unknown`. A parsed duration below the fictional 6 hours fails. The complete-claim letter states 8 hours and passes. Any stated reason satisfies the assignment. A closed list of acceptable reasons would be a new demo assumption and needs an explicit label if it is added.

- A letter is present, and the noul result contradicts “states a delay reason” or “states a delay duration” (at or below 0.25). Is that check `fail` or `unknown`?
- What parsed value should the under-6-hour case use, and what source text should the unparseable-duration case use?
- Are the under-6-hour case, the unparseable-duration case, the outside-coverage case, and the missing-policy case full sample bundles, or policy-test inputs only?

### 5. Filing deadline and calendar fixture

Working assumption: Singapore calendar dates, return date as day zero, next working day as day one, and filing on day 30 accepted. The next working day after day 30 is late. The complete claim is received on Wednesday 12 August 2026 after a Friday 7 August return. That window skips the weekend of 8–9 August and Monday 10 August 2026, which the current story treats as National Day observed. The review screen shows the return date, the counted working days, and the deadline date. Those dates are stored with the claim. They are the inputs to the count.

- Which published 2026 Singapore public-holiday calendar will be frozen in `demo-2026.1`, and will the fixture contain the full year or only dates the scenarios need? Confirm or replace the 10 August 2026 observed-holiday assumption against that calendar.
- Is the counting convention above acceptable for the interview demo?
- What exact sample date is the next working day after day 30, so the late case lands on a working day?

### 6. Synthetic sample bundles

Working assumption: live external Jev calls use synthetic data only. Real customer or personal travel documents stay out of those calls. The rehearsal stories are the complete two-flight claim, the missing 7 August pass, and a conflict or unreadable case.

- Who will create the synthetic PDFs and images, and what tool or format will make the text-based and image-only cases behave as intended?
- What exact values and expected outcomes does the conflict bundle contain: which documents disagree, on which field, and what each check returns?
- Is the image-only file part of the conflict story, or a separate bundle? The required demonstration is “conflicting or unreadable.” Decide whether the audience sees both.
- What claim-form fields and policy record are included in each bundle? Keep every value fictional.
- Which cases from section 4 are bundles the talk shows, and which are automated tests only? Late filing, short delay, unparseable duration, outside coverage, and a missing policy record need expected results either way.
- What upload limits apply: accepted types, maximum size, and maximum pages? Define the result for a file beyond the one-or-two-page demo assumption before that file can be sent to Jev.

## Resolve before or during integration

### 7. Jev access and operating constraints

- A TypeSafe key was used. `jev-1.13.0` classified the seven files on `CLM-DEMO-1001`. Every label matched the filename at probability 1, and no answer abstained. Keep the demo off the `jev-latest` alias.
- What account rate limits, request-size limits, token pricing, and data retention/processing terms apply to the demo account?
- Can the chosen candidate-span question format represent the actual number of spans produced by the parser within the API's option limits?
- Document classification on the complete bundle matched every filename at probability 1, with no abstention. The delay letter was asked whether it states a reason and a duration. The reason was 0.98 and the duration was 0.99, so both support the proposition. This letter states both facts in plain text, so those answers did not show the middle band or a contradiction. A later file has to be one where a reason or a duration is missing or unclear. Evidence-span selection has not been run. Record correctness, abstentions, grounding, provider usage, and failures for that when it is. Which outputs should be pinned to the fixture for reliable presentation?
- What minimum quality and abstention criteria would count as “handles most semantic judgment” for this prototype? Do observed results meet them, and do they justify changing any current abstention gates?


### 8. Persistence, intake, and access

Working status list: submitted, processing, needs review, information requested, approved, rejected. Working policy binding: every claim uses `demo-2026.1` unless a test omits the policy record on purpose.

Stage 2 stores officers, one policy row, claims, documents, pages, and items in the hosted Supabase project SureCover Claims. The schema is `supabase/migrations/20261014083345_system_of_record.sql`. `quotable_pages` in `supabase/migrations/20261014085334_quotable_pages.sql` is what the checks quote: pages whose `text_source` is `embedded` or `ocr`. `supabase/migrations/20261014101830_policy_checks.sql` adds `assessments` and `policy_checks`. `supabase/migrations/20261014113206_delay_check.sql` adds `delay` to the allowed check names. Reads use the assignment row and `auth.uid()`. The seeded claim `CLM-DEMO-1001` is assigned to `officer-a@example.com` and now has seven files, including `boarding-pass-sc202.pdf`. `npm run verify:access` confirms officer A can read the claim and that the stored files match the fixtures, and that `officer-b@example.com` receives no claim rows and no file bytes. `npm run assess:claim` stores one passing assessment from `checks/assess.mjs`, including a separate `delay` check for the fictional 6-hour rule. `npm run verify:checks` shows that assessment to officer A and shows officer B no assessment and no check rows. `claim_messages`, `claim_decisions`, `document_classifications`, and `document_judgments` are stored. `workflow_events` and `notifications` remain only in `Brainstorm.md`.

- The schema records officers, policies, claims, documents, pages, items, assessments, policy checks, claim decisions, claim messages, document classifications, document judgments, and the private `claim-files` bucket. `workflow_events` and `notifications` remain only in `Brainstorm.md`.
- Claim and file reads use the officer's JWT and row-level security. `npm run verify:access` uses the publishable key only. `npm run seed:claim` uses the secret key in `.env` to create users and load rows. That key is not a client.
- `npm run seed:claim` creates `officer-a@example.com` and `officer-b@example.com` through the Auth admin API and assigns `CLM-DEMO-1001` to officer A. Officer B's reads return no rows and no file bytes.
- Which actions create workflow events, and what event fields are mandatory (actor, time, channel, assessment/policy version, notes)?
- Which transitions trigger an automatic acknowledgment/status message, and what transitions are allowed? Use deterministic templates and record provider message id, delivery status, and failure. Identify the public webhook URL, signing-secret verification, idempotency key, and retry behavior.
- How are Resend inbound emails and attachments mapped to a claim? Verify webhook signatures, deduplicate provider retries, validate attachment type/size, and apply a write/access policy separate from operator reads.
- How will the inbound domain/address be configured, and what test strategy gives Resend a reachable webhook during local development (public deployment or secure tunnel)? Use synthetic messages and decide how a reply/claim reference safely matches a traveler email to an existing claim.
- Processing starts when the claim is submitted. Opening the review screen reads the stored assessment. What does the operator see when local extraction fails for one file in a bundle? When Jev is unavailable, the upload is stored and the facts are `unknown`.

### 9. Review and follow-up

Working assumption for the core path: the operator may approve, reject, or request information. All three stay available and are not ranked. Each requires a rationale. Approving while a check is `fail` or `unknown` requires that rationale to name those results. An authorized officer may correct an extracted fact. The officer does not pick a winning value for a material conflict. A conflict stays visible and the check stays `unknown`. An information request moves the claim to information requested. A later traveler reply matched to that claim is stored on it. The new documents are classified and extracted, affected checks are recomputed, and the new assessment is kept beside the previous one. The status returns to needs review. The reply does not approve or reject the claim. How the reply is matched remains open in section 8.

- Resolved: the officer can correct every parsed fact. That is each leg's flight number, departure date, origin, and destination on the claim form, the boarding passes, and the revised itinerary, plus the form return date, the claim type, and the delay letter's hours and reason. A leg is keyed by the source file and flight number, by the original departure date when that flight number is repeated, and by the original origin and destination when that date is repeated too. The save rejects a check payload that disagrees with the hours, claim type, or departure date just stored. The original quote stays on the fact. The new value must differ from the value in effect and must match the parser's shape: a flight number, a date, a three-letter airport, a number of hours, or non-empty text for claim type and reason. The rationale is required. The event stores the officer, the time, the rationale, the corrected value, and the assessment that correction produced. The document text is not rewritten. Copying one Singapore date onto the other leaves filing `unknown` while the original quotes differ. A shared date that is neither of those conflicting values can agree.
- Resolved: the assigned officer can request information, approve, or reject. The three actions stay together and are not ranked. Each requires a rationale and records the officer, the time, and the latest assessment. Approving while a check is `fail` or `unknown` names that check as its own words in the rationale. A request sets `information requested` and leaves approve and reject available. Approve and reject finish the claim. A second request, or any decision after the claim is finished, is rejected. A simulated message is recorded for that request, and nothing is delivered. A traveler reply is still later.
- Can the officer choose a winning source value when sources conflict, or must the conflict remain unresolved? Current rule for the two Singapore dates: copying one date onto the other does not resolve filing. A later correction to a date that is neither conflicting value can.
- Can an officer edit the deterministic information-request template before the request is sent through Resend? The simulated adapter is used only when provider configuration is unavailable. Define the allowed edits, if any.
- Which status transitions produce customer-facing messages, and which outcomes require an explicit operator action before a message is recorded? Define the template for the missing-pass request and any approval/rejection updates sent through Resend.
- Is the stored quote enough on the review screen, or does the screen also render the PDF or image? The reviewer must be able to see the passage behind a fact. A PDF or image renderer is an extra dependency in section 10.

### 10. Local development and dependencies

- Node 24 and Supabase CLI 2.120 are installed. Local `supabase start` needs Docker, and this machine's firmware has virtualization disabled. The prototype uses the hosted project SureCover Claims (`xrsqiqcyvhkfvyipcqhf`).
- The local PDF and image parser is Docling. See the resolved document-parser note. An empty page means no ink. An unreadable page is an unknown gap and is not sent as text.
- If section 9 requires rendering the original file, which viewer is used?
- `.env.example` names `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `OFFICER_PASSWORD`. `.env` is gitignored. A fresh clone copies that example and fills the three secrets from the SureCover Claims project.
- If local Supabase setup threatens the stop line, what is the fallback persistence and auth approach that still demonstrates claim isolation? Local Docker could not start because firmware virtualization is off. The prototype uses hosted project SureCover Claims. Claim isolation is the assignment row and row-level security, checked by `npm run verify:access`.

## Resolve before live integration and rehearsal

### 11. Resend account and domain setup

Working assumption: Resend is the preferred prototype provider for real inbound/outbound email with deterministic templates. The simulation adapter is a local/rehearsal fallback.

- Which Resend account/API key and inbound address can be used for the prototype? Resend supports a provider-supplied inbound address or a configured domain and delivers `email.received` events to a webhook.
- Which sender domain/address will be used for outbound mail, and is its DNS verification available?
- Which public HTTPS endpoint will receive webhooks, and how will signatures, retries, and duplicate deliveries be handled?
- Which controlled recipient addresses will be used for test claims and replies?
- How will provider retention and personal-data handling be bounded? Prototype messages and attachments must be fictional.
### 12. Scope and rehearsal

- What is the exact assignment completion and presentation date, and how much time must be protected for rehearsal? The project notes say less than a week remains and do not record the confirmed deadline.

- During the 20 minutes, does the talk submit the PDF form through Resend live, show preprocessed claims, or both? The checks use stored scenario dates. Decide which acknowledgment/status messages to demonstrate.

## Documentation alignment

`ProductDesign.md`, `Direction.md`, `SuccessCriteria.md`, `README.md`, `Backlog.md`, and `UsefulLinks.md` now reflect the Resend email integration, local simulation fallback, and Jev-priority/LLM-backup hypothesis.









