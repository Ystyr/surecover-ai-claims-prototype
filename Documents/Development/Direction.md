# Direction

This document records the project's current technical and system direction. `ProductDesign.md` defines the user outcome and product experience; `Brainstorm.md` keeps rationale and alternatives; `OpenQuestions.md` tracks unresolved decisions. Update this file when a product boundary or architectural decision changes.

## Product goal

Turn submitted documents into review-ready airline flight-delay claims so SureCover operations officers spend less time gathering facts and more time resolving cases that need judgment. The officer is the primary user; the traveler is the submitting user. See `ProductDesign.md` for the personas, journey, workbench, product principles, and measurement plan. The interview assignment has a one-week window and requires a working prototype plus a 20-minute presentation. Optimize for a reliable end-to-end demonstration and clear engineering judgment, not production completeness.

The core prototype demonstrates a real traveler email exchange and ends with an operator decision and resulting status message recorded. Resend is the preferred provider; retain a simulated adapter for local development and deterministic rehearsal.

## Core workflow

1. Receive a traveler email with the completed PDF claim form and supporting documents through Resend inbound webhooks. Send deterministic acknowledgment/status messages through Resend; use the simulated adapter when credentials or a public webhook endpoint are unavailable.
2. Parse document text and classify document types and relevant claim attributes.
3. Store extracted facts with references to the source document and page/text span.
4. Run deterministic completeness and policy checks against a versioned demo policy.
5. Present the original evidence, extracted facts, classifier output, check results, uncertainty, and the available actions in an operations review screen. Do not rank approve, reject, or request information.
6. Let the operator approve, reject, or request more information, and record that decision in the claim timeline. A request sends a deterministic email. A later reply matched to that claim is stored on it, assessed, and returned to needs review.

The required assignment documents are a completed claim form, scheduled and revised itinerary, a boarding pass for every affected flight, and an airline/handling-agent letter confirming delay reason and duration. The assignment states that the claim must be submitted within 30 working days after return to Singapore.

## System boundaries

### Classification and extraction

Prioritize TypeSafe Jev as the semantic model to evaluate behind a replaceable adapter; whether it handles most required semantic judgment is a prototype hypothesis, not yet a proven capability. Jev receives one state per text-bearing document: that document's page text plus the candidate ids. It does not read the uploaded PDF or image directly, make policy decisions, or take workflow actions. Question wording is authored in application code and is never built from the document. Application code parses text and prepares candidate spans. Jev classifies the document and may choose among those candidates; code verifies a selected span exists in the source text before storing it as evidence. Demo files are one or two pages so that state stays small.

The hypothesis is that Jev can handle document labels, semantic support questions, and span choice, while code controls workflow and operators resolve uncertain cases. Evaluate this on labeled synthetic examples. Jev is the priority. A generative LLM is the backup plan only for a specific semantic task that Jev cannot handle adequately, and only when the added cost, data exposure, and failure modes are justified. Deterministic code remains responsible for parsing and checking values.

Keep a fixture adapter with the same contract so the full demo can run without a live Jev call. Record which adapter and model produced each result. Do not describe Jev as integrated until a real request has been made and its outputs have been reviewed against the demo documents.

### Deterministic policy and workflow logic

Ordinary application code owns schema validation, date parsing, working-day calculation, cross-document comparisons, required-document checks, policy evaluation, authorization, and workflow transitions. Checks return:

- `pass` when sufficient evidence supports the condition;
- `fail` when sufficient evidence establishes that a configured condition is not met;
- `unknown` when the input is unreadable, ambiguous, or conflicting, or a value could not be established.

Absence of a required document fails completeness and names the gap. That result is not an eligibility conclusion, and it is not stored as `unknown`. Affected flights are records, not a single flat field. Completeness is a set comparison: every affected flight has a matching boarding pass.

A classifier result is not a policy result. A policy result is not the operator's final decision. Nothing is auto-approved or auto-rejected.

### Human review and notifications

The operator retains final authority to approve, reject, or request more information. The queue lists only claims assigned to the signed-in officer. A new claim is assigned when it is created. All three actions stay available and are not ranked. Each requires a rationale. An approval while any check is `fail` or `unknown` records a rationale that names those results. `unknown` is not stored as `fail`. An authorized operator may correct an extracted fact; preserve the original extraction and provenance, record the correction as an event, and recompute affected deterministic checks while retaining the prior assessment. Application code assembles acknowledgment, status, and follow-up messages from deterministic templates and claim state; no model writes them. Resend sends the real email in the configured prototype path. Record provider message ids, delivery outcomes, and failures. The simulated adapter is the fallback. A traveler reply matched to a claim in information requested is stored on that claim. The new documents are classified and extracted, affected checks are recomputed, and the new assessment is kept beside the previous one. The status returns to needs review. The reply cannot approve or reject the claim. How the reply is matched remains open in `OpenQuestions.md` section 8.

## Policy treatment

The actual SureCover policy wording was not provided. Keep rules explicit, configurable, and versioned. Clearly identify all invented terms as fictional demo assumptions.

Use a synthetic, versioned policy record with a coverage period so the prototype can demonstrate the assignment's coverage-period check. Flight documents never supply that period, and the seeded dates are not the itinerary dates. With readable claim dates, dates inside the seeded period are `pass` and dates outside it are `fail`. A missing policy record, or dates that cannot be read, are `unknown`.

`demo-2026.1` also includes a fictional minimum delay of 6 hours, labeled as a demo assumption. Code compares it with the parsed duration from the airline letter. A duration that cannot be parsed is `unknown`.

The same policy version freezes the filing convention. Dates are Asia/Singapore calendar dates. The return date is day 0 and is not counted. The next working day is day 1, and filing on the 30th working day is in time. Saturday, Sunday, and the Singapore public holidays listed in that version are not working days. The deadline check shows the return date, the counted working days, and the deadline date. These are demo fixtures, not claims about actual SureCover policy terms.

Received time, return date, flight dates, and the holiday list are scenario values stored with the claim and the policy version. Deadline, coverage, and delay checks are a function of those stored values. Opening the same claim on another calendar day leaves the result unchanged.

`checks/assess.mjs` is that function. Seeded document roles come from the filename and are recorded as adapter `fixture`. Quotes are items on `quotable_pages`. `npm run assess:claim` inserts an `assessments` row and six `policy_checks` rows, and a later run keeps the previous assessment. The stored complete claim passes all six. Its filing detail is the 7 August 2026 return, working day 2, and deadline 21 September 2026. The `delay` check holds the parsed duration. Eight hours passes the fictional 6-hour rule. Three hours fails that check. An unparseable duration is `unknown`. Completeness stays the document check. A missing required document fails completeness even when a flight date on the form cannot be read. Consistency is `unknown` when two readable values disagree. A revised itinerary with no Singapore arrival leaves the filing check on the form return date. `npm run verify:checks` reads those rows with the assigned officer's JWT. The other officer receives none.

`npm run dev` is the officer workbench. It signs in with the publishable key and reads through that session. A redirect keeps the refreshed session cookie. A sign-in that cannot store that cookie does not open the queue. The queue lists assigned claims, and action needed appears only for `needs review`. The claim screen shows the latest six checks, their quotes, the original files, and every stored assessment. A quote opens the file stored with that quote. Request, Approve, and Reject are visible together and do not record a decision. The screen does not recompute the checks.

## Context and evidence

Persist structured workflow state as the source of truth rather than relying on a long prompt history. Keep separate references for:

- Original documents and parsed page text.
- Extracted facts, source page/span, and unresolved conflicts.
- Raw classifier response, normalized result, adapter name, and model/question-set version.
- Applicable demo-policy version and rule outcomes.
- Workflow events, outstanding actions, notification records, and operator decisions.

Assemble only the current claim/document context required for a model call. Do not send other claims or policy instructions as if they were document content. Uploaded files and their text are untrusted evidence; any embedded instructions must not change system behavior or access rights.

## Security direction

Use private file storage and enforce claim- and role-scoped access for both claim records and document objects. Demonstrate that an operator cannot retrieve an unassigned claim or its files.

Keep the TypeSafe key, Resend API key, Resend webhook signing secret, and any Supabase service-role key on the server. For access-control reads, prefer the authenticated operator identity with database/storage RLS applied. If a privileged server-side operation uses the service-role key, it must first perform an explicit authorization check; server-side placement alone does not make that operation claim-scoped.

Use fictional sample documents and controlled test recipient addresses for all prototype email and live Jev calls. Real claim documents contain personal and travel information; do not send them to external providers unless data handling, retention, and authorization have been reviewed.

Give AI components no unrestricted SQL, generic database access, or side-effecting tools. Model output can classify a document or select a span. Application code assembles deterministic email templates from claim state. Only authorized application actions and the operator can change claim status or initiate a notification; configured status events use application-controlled templates. Verify Resend webhook signatures and deduplicate events before processing to prevent duplicate claims or replies.

## Technology direction

Current prototype direction:

- **Web app:** Next.js App Router and TypeScript. `npm run dev` is the signed-in queue and claim screen. Intake email is still later.
- **Persistence and access:** Hosted Supabase project SureCover Claims (`xrsqiqcyvhkfvyipcqhf`, Singapore) for Postgres, Auth, RLS, and private Storage. Docker is not required. `.env` holds the project URL, the publishable key, the secret key, and the officer password, and is not committed. Later code quotes `quotable_pages`.
- **Semantic model:** Prioritize Jev behind a server-side adapter and evaluate on labeled synthetic examples; keep a deterministic fixture adapter for offline/rehearsal.
- **Document parsing:** Local Docling, standard pipeline, through `parser/convert_document.py`. Provenance items are individual text lines or table cells. Every box is stored in `BOTTOMLEFT` coordinates. Each page has its own `text_source`: `embedded` when that page's items come from the PDF text layer, `ocr` when that page is read with English OCR, `empty` when the page has no ink, and `unreadable` when the page has visible content but no extracted text. A scanned page inside a text PDF is OCR'd on its own and is not left as a silent blank page. The file `text_source` is `empty` only when every page is blank, `unreadable` when no page produced text and at least one page has ink, `partial` when at least one page produced text and at least one page is unreadable, `ocr` when any page was read by OCR and none is unreadable, and `embedded` when every page that produced text came from the PDF text layer and none is unreadable. Each OCR line keeps its recognition score from 0 to 1. RapidOCR already omits lines below 0.5. A kept score below 0.80 sets `review` on that line, and the line stays in the parse. Embedded text has no OCR score. Later code quotes only pages whose `text_source` is `embedded` or `ocr`. An `unreadable` page is an unknown gap on that document and is not sent as text. A `partial` file keeps its readable pages; the whole file is not dropped. An `empty` page means no ink, not that the traveler submitted nothing. An empty or unreadable parse is not evidence that the facts are absent. A corrupt, password-protected, unsupported, or oversized file raises instead of returning a parse. The vision-language pipeline and picture descriptions stay off. Recorded parses in `fixtures/parses/` are the rehearsal artifact. Docling Serve can host the same JSON contract later; stage 1 calls the local Python script.
- **Email:** Resend inbound webhooks and outbound email API for the PDF form, attachments, acknowledgments, status updates, and follow-up messages. Use deterministic templates and persist messages/events. Provide a simulated adapter for local development and rehearsals.

Do not add a vector database or a general-purpose agent orchestration framework unless implementation evidence shows it is needed for the focused workflow. Jev is the priority semantic model. A generative LLM is a backup for a specific task only if Jev evaluation shows it cannot handle that task adequately.

## Demonstration scope

The core demo should show:

1. A complete synthetic claim emailed to the Resend inbound address with the PDF claim form, two affected flights, and a boarding pass for each; show receipt acknowledgment and a status message delivered to a controlled test recipient. Configured checks pass, including claim dates inside the seeded coverage period and a filing window that includes one weekend and one listed public holiday.
2. A missing boarding pass submitted by email, with the flight gap named, a completeness finding, and a specific request reply delivered to a controlled test recipient.
3. Conflicting or unreadable evidence producing `unknown` and human review.
4. An access-control denial for an operator outside the claim assignment.
5. The complete claim again through the fixture adapter, with the adapter identified and no provider token usage.

Show the source evidence alongside the assessment and finish with an operator decision. The `submitted` event records `channel=email` and provider metadata (for example, `provider=resend` and provider message id). The claim history shows provider message ids and delivery states for acknowledgment and status/reply messages. The simulated adapter remains available for rehearsal.

## Provisional decisions

- Jev is the leading semantic-classification candidate because it was emphasized in the interview, but its ability to handle most semantic judgment is a hypothesis to test. A fixture path remains available, and results determine whether any generative LLM is justified.
- Stack direction is a hosted Supabase project, chosen after local Docker could not start on this machine. The access-control story is unchanged: row-level security and the assignment row.
- The demo policy is synthetic. Only the 30-working-day filing window and document list come directly from the assignment brief. Coverage period is checked against a seeded policy record. The 6-hour delay and the abstain gates are labeled demo assumptions frozen in `demo-2026.1` and `jev-questions-demo-2026.1`.
- The complete-claim fixture locks, including form fields, flight matching, delay outcomes, the 10 August 2026 holiday, and talk versus test bundles, are recorded in `fixtures/expected/complete-claim.json`.
- Production-grade email operations, claims-system integration, payouts, and a generative LLM remain outside the core prototype unless evaluation and remaining time justify a specific addition. Demo screenshots and empty text layers are read with Docling. Production-scale OCR operations remain outside this prototype.









