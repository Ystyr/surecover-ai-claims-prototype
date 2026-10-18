import { correctFact } from "@/app/claims/[id]/actions"
import { DecisionPanel } from "@/app/claims/[id]/decision-panel"
import { Fold } from "@/app/claims/[id]/fold"
import {
  CHECK_LABELS,
  CLAIM_ABSENT_MESSAGE,
  CLAIM_READ_ERROR_MESSAGE,
  assessmentHistoryNote,
  assessmentOutcomeLine,
  ROLE_LABELS,
  clearerPhotoGaps,
  conflictingReturnSentence,
  failedCompletenessGaps,
  requestMessageText,
  timelineNewestFirst,
  classificationEstablished,
  JUDGMENT_LABELS,
  judgmentReading,
  SPAN_LABELS,
  spanEstablished,
  claimPageMessage,
  claimUrgent,
  isUuid,
  displayDate,
  displayInstant,
  findingQuotes,
  findingSummary,
  sortChecks,
  type CheckRow,
  type DocumentRow,
} from "@/lib/findings"
import { createClient } from "@/lib/supabase/server"

type AssessmentRow = {
  id: string
  adapter: string
  created_at: string
  policy_checks: CheckRow[] | null
}

type FactRow = {
  id: string
  fact_key: string
  source_file: string
  document_id: string | null
  quote_text: string | null
  field: string
  leg_index: number | null
  original_value: string
}

type DecisionRow = {
  id: string
  action: "request" | "approve" | "reject"
  rationale: string
  created_at: string
}

type ClassificationRow = {
  id: string
  document_id: string
  adapter: string
  model: string | null
  question_set: string
  label: string
  probability: number | string
  created_at: string
}

type JudgmentRow = {
  id: string
  document_id: string
  question: string
  noul: number | string
  created_at: string
}

type SpanRow = {
  id: string
  document_id: string
  question: string
  choice: string
  quote: string | null
  probability: number | string
}

type MessageRow = {
  id: string
  decision_id: string | null
  to_address: string
  subject: string
  body: string
  provider: string
  status: string
  created_at: string
}

type ReplyRow = {
  id: string
  from_address: string
  subject: string
  body: string | null
  urgency_noul: number | null
  provider: string
  created_at: string
}

type CorrectionRow = {
  id: string
  fact_id: string
  corrected_value: string
  rationale: string
  created_at: string
}

const FIELD_ORDER = [
  "flight_number",
  "departure_date",
  "origin",
  "destination",
  "return_date",
  "claim_type",
  "hours",
  "reason",
]

const FIELD_LABELS: Record<string, string> = {
  flight_number: "Flight number",
  departure_date: "Departure date",
  origin: "Origin",
  destination: "Destination",
  return_date: "Return date",
  claim_type: "Claim type",
  hours: "Delay hours",
  reason: "Delay reason",
}

const DECISION_ACTIONS = ["request", "approve", "reject"] as const

const ACTION_LABELS: Record<(typeof DECISION_ACTIONS)[number], string> = {
  request: "Request",
  approve: "Approve",
  reject: "Reject",
}

const DECISION_MESSAGES: Record<string, string> = {
  rationale: "A rationale is required.",
  unnamed: "Name each failed or unresolved check in the rationale.",
  stale: "Another assessment was saved first. Review the checks and submit again.",
  recorded: "This decision is already recorded.",
  save: "The decision could not be saved.",
}

const MESSAGE_ERRORS: Record<string, string> = {
  recorded: "This request message is already recorded.",
  save: "The message could not be saved.",
}

const CORRECTION_MESSAGES: Record<string, string> = {
  rationale: "A rationale is required.",
  invalid: "That value is not valid for this fact.",
  unchanged: "That is already the value in effect.",
  missing: "This fact is not on the claim.",
  read: "The facts could not be read.",
  save: "The correction could not be saved.",
  stale: "Another correction was saved first. Review the values and submit again.",
}

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ correction?: string; decision?: string; message?: string }>
}) {
  const { id } = await params
  const query = await searchParams
  if (!isUuid(id)) {
    return (
      <ClaimNotice
        message={
          claimPageMessage({
            claimId: id,
            claimError: null,
            claim: null,
            documentError: null,
            assessmentError: null,
          }) ?? CLAIM_ABSENT_MESSAGE
        }
      />
    )
  }

  const supabase = await createClient()
  const claimResult = await supabase
    .from("claims")
    .select("id, reference, claimant_name, status, received_at, return_date, policy_version, policy_reference")
    .eq("id", id)
    .maybeSingle()

  const claim = claimResult.data
  if (claimResult.error || !claim) {
    return (
      <ClaimNotice
        message={
          claimPageMessage({
            claimId: id,
            claimError: claimResult.error,
            claim,
            documentError: null,
            assessmentError: null,
          }) ?? CLAIM_ABSENT_MESSAGE
        }
      />
    )
  }

  const [documentResult, assessmentResult, factResult, decisionResult, messageResult, replyResult, classificationResult, judgmentResult, spanResult] = await Promise.all([
    supabase.from("claim_documents").select("id, source_file, media_type").eq("claim_id", claim.id).order("source_file"),
    supabase
      .from("assessments")
      .select("id, adapter, created_at, policy_checks(check_name, outcome, detail)")
      .eq("claim_id", claim.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("extracted_facts")
      .select("id, fact_key, source_file, document_id, quote_text, field, leg_index, original_value")
      .eq("claim_id", claim.id)
      .order("source_file")
      .order("leg_index", { nullsFirst: false })
      .order("field"),
    supabase
      .from("claim_decisions")
      .select("id, action, rationale, created_at")
      .eq("claim_id", claim.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("claim_messages")
      .select("id, decision_id, to_address, subject, body, provider, status, created_at")
      .eq("claim_id", claim.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("inbound_messages")
      .select("id, from_address, subject, body, urgency_noul, provider, created_at")
      .eq("claim_id", claim.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("document_classifications")
      .select("id, document_id, adapter, model, question_set, label, probability, created_at")
      .eq("claim_id", claim.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("document_judgments")
      .select("id, document_id, question, noul, created_at")
      .eq("claim_id", claim.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("document_span_choices")
      .select("id, document_id, question, choice, quote, probability")
      .eq("claim_id", claim.id),
  ])
  const factIds = (factResult.data ?? []).map((fact) => fact.id)
  const correctionResult = factIds.length
    ? await supabase
        .from("fact_corrections")
        .select("id, fact_id, corrected_value, rationale, created_at")
        .in("fact_id", factIds)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
    : { data: [] as CorrectionRow[], error: null }
  const blocked = claimPageMessage({
    claimId: id,
    claimError: null,
    claim,
    documentError: documentResult.error || factResult.error || correctionResult.error || decisionResult.error || messageResult.error || replyResult.error || classificationResult.error || judgmentResult.error || spanResult.error,
    assessmentError: assessmentResult.error,
  })
  if (blocked) return <ClaimNotice message={blocked} />

  const documents = documentResult.data
  const assessments = assessmentResult.data

  const files = (documents ?? []) as DocumentRow[]
  const facts = ((factResult.data ?? []) as FactRow[]).sort((left, right) => {
    const file = left.source_file.localeCompare(right.source_file)
    if (file !== 0) return file
    const leg = (left.leg_index ?? 99) - (right.leg_index ?? 99)
    if (leg !== 0) return leg
    return FIELD_ORDER.indexOf(left.field) - FIELD_ORDER.indexOf(right.field)
  })
  const corrections = (correctionResult.data ?? []) as CorrectionRow[]
  const decisions = (decisionResult.data ?? []) as DecisionRow[]
  const messages = (messageResult.data ?? []) as MessageRow[]
  const replies = (replyResult.data ?? []) as ReplyRow[]
  const classifications = (classificationResult.data ?? []) as ClassificationRow[]
  const judgments = (judgmentResult.data ?? []) as JudgmentRow[]
  const spans = (spanResult.data ?? []) as SpanRow[]
  const history = (assessments ?? []) as AssessmentRow[]
  const latest = history[0]
  const checks = sortChecks(latest?.policy_checks ?? [])

  return (
    <article>
      <p className="back">
        <a href="/">Back to the queue</a>
      </p>
      <section className="panel">
        <div className="row-head">
          <h2>{claim.reference}</h2>
          <span className="status">{claim.status}</span>
          {claimUrgent(replies.map((reply) => reply.urgency_noul)) ? <span className="urgent">Urgent</span> : null}
          {claim.status === "needs review" ? <span className="needed">Action needed</span> : null}
        </div>
        <p>
          {claim.claimant_name} · policy {claim.policy_reference} · {claim.policy_version}
        </p>
        <p>
          Return {displayDate(claim.return_date)} · received {displayInstant(claim.received_at)}
        </p>
        {checks.length > 0 ? (
          <ul className="check-row">
            {checks.map((check) => (
              <li key={check.check_name}>
                <a className="check-chip" href={`#check-${check.check_name}`}>
                  {CHECK_LABELS[check.check_name] ?? check.check_name}
                  <span className={`outcome outcome-${check.outcome}`}>{check.outcome}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <DecisionPanel
          actions={openDecisionActions(decisions)}
          assessmentId={latest?.id ?? null}
          claimId={claim.id}
          finished={finishedDecision(decisions)}
          message={query.decision ? DECISION_MESSAGES[query.decision] : undefined}
          preview={requestPreview(decisions, messages, {
            reference: claim.reference,
            claimantName: claim.claimant_name,
            gaps: failedCompletenessGaps(checks.find((entry) => entry.check_name === "completeness")),
            photoGaps: clearerPhotoGaps(checks.find((entry) => entry.check_name === "completeness")),
            dateLine: conflictingReturnSentence(checks.find((entry) => entry.check_name === "filing_deadline")),
          })}
          requestMessage={query.message ? MESSAGE_ERRORS[query.message] : undefined}
        />
      </section>

      <section>
        <h2>Findings</h2>
        {checks.map((check) => (
          <Finding check={check} claimId={claim.id} documents={files} key={check.check_name} />
        ))}
      </section>

      <Fold
        className="panel facts"
        startOpen={Boolean(query.correction && CORRECTION_MESSAGES[query.correction])}
        summary={
          <span className="finding-head">
            <h2>Facts</h2>
            <span className="muted">{facts.length === 0 ? "None stored" : facts.length}</span>
          </span>
        }
      >
        <p className="muted">A correction keeps the original quote and recomputes the checks. It does not change the file.</p>
        {query.correction && CORRECTION_MESSAGES[query.correction] ? (
          <p className="error">{CORRECTION_MESSAGES[query.correction]}</p>
        ) : null}
        {facts.length === 0 ? <p>No parsed facts are stored for this claim.</p> : null}
        {factGroups(facts).map((group) => (
          <div key={group.file}>
            <h3 className="file-group">{group.file}</h3>
            {group.facts.map((fact) => (
              <FactForm claimId={claim.id} corrections={corrections} fact={fact} key={fact.id} />
            ))}
          </div>
        ))}
      </Fold>

      <section className="panel">
        <h2>Files</h2>
        <ul className="files">
          {files.map((document) => {
            const fixture = classifications.find((row) => row.document_id === document.id && row.adapter === "fixture")
            const jev = classifications.find((row) => row.document_id === document.id && row.adapter === "jev")
            const established = jev ? classificationEstablished(jev.label, Number(jev.probability)) : false
            const fileJudgments = ["delay_reason", "delay_duration"].flatMap((question) =>
              judgments.filter((row) => row.document_id === document.id && row.question === question),
            )
            const fileSpans = ["delay_reason_span", "delay_duration_span"].flatMap((question) =>
              spans.filter((row) => row.document_id === document.id && row.question === question),
            )
            const role = fixture
              ? (ROLE_LABELS[fixture.label] ?? fixture.label)
              : jev
                ? (ROLE_LABELS[jev.label] ?? jev.label)
                : null
            const hasReading = Boolean(fixture || jev || fileJudgments.length > 0 || fileSpans.length > 0)
            return (
              <li key={document.id}>
                <a href={`/claims/${claim.id}/files/${document.id}`}>{document.source_file}</a>
                {role ? <span className="muted"> · {role}</span> : null}
                {hasReading ? (
                  <details className="reading">
                    <summary>Reading</summary>
                    {fixture ? <p className="muted">Fixture · {ROLE_LABELS[fixture.label] ?? fixture.label}</p> : null}
                    {jev ? (
                      <p className="muted">
                        Jev · {ROLE_LABELS[jev.label] ?? jev.label} · {jev.probability} · {jev.model} · {jev.question_set}
                        {established ? null : " · the label is not established"}
                      </p>
                    ) : null}
                    {fileJudgments.map((row) => (
                      <p className="muted" key={row.id}>
                        Jev · {JUDGMENT_LABELS[row.question] ?? row.question} · {row.noul} · {judgmentReading(Number(row.noul))}
                      </p>
                    ))}
                    {fileSpans.map((row) => {
                      const spanReady = spanEstablished(row.choice, Number(row.probability), row.quote)
                      return (
                        <p className="muted" key={row.id}>
                          Jev · {SPAN_LABELS[row.question] ?? row.question}
                          {spanReady ? ` · ${row.quote}` : ""} · {row.probability}
                          {spanReady ? "" : " · the span is not established"}
                        </p>
                      )
                    })}
                  </details>
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="panel">
        <h2>History</h2>
        <ul className="history">
          {timelineNewestFirst(decisions, history, messages, replies).map((event) => {
            if (event.kind === "decision") {
              return (
                <li key={event.item.id}>
                  <strong>{displayInstant(event.item.created_at)}</strong>
                  <span> · {ACTION_LABELS[event.item.action]} · {event.item.rationale}</span>
                </li>
              )
            }
            if (event.kind === "reply") {
              return (
                <li key={event.item.id}>
                  <details>
                    <summary>
                      <strong>{displayInstant(event.item.created_at)}</strong>
                      <span> · Reply · {event.item.subject}</span>
                    </summary>
                    <p className="muted">From {event.item.from_address} · {event.item.provider}</p>
                    {event.item.body ? <div className="message-body">{event.item.body}</div> : null}
                  </details>
                </li>
              )
            }
            if (event.kind === "message") {
              return (
                <li key={event.item.id}>
                  <details>
                    <summary>
                      <strong>{displayInstant(event.item.created_at)}</strong>
                      <span> · Message · {event.item.subject}</span>
                    </summary>
                    <p className="muted">To {event.item.to_address} · {event.item.provider} · {event.item.status}</p>
                    <div className="message-body">{event.item.body}</div>
                  </details>
                </li>
              )
            }
            const assessment = event.item
            const index = history.findIndex((row) => row.id === assessment.id)
            const outcomes = assessmentOutcomeLine(assessment.policy_checks ?? [])
            const earlier = history[index + 1]
            const historyNote = earlier ? assessmentHistoryNote(assessment.policy_checks ?? [], earlier.policy_checks ?? []) : null
            return (
              <li key={assessment.id}>
                <strong>{displayInstant(assessment.created_at)}</strong>
                <span className="muted"> · {assessment.adapter}</span>
                {assessment.id === latest?.id ? <span className="muted"> · shown above</span> : null}
                {historyNote ? <span className="muted"> · {historyNote}</span> : null}
                <div>{outcomes}</div>
              </li>
            )
          })}
        </ul>
      </section>
    </article>
  )
}

function openDecisionActions(decisions: DecisionRow[]): Array<(typeof DECISION_ACTIONS)[number]> {
  if (decisions.some((decision) => decision.action === "approve" || decision.action === "reject")) return []
  if (decisions.some((decision) => decision.action === "request")) return ["approve", "reject"]
  return [...DECISION_ACTIONS]
}

function finishedDecision(decisions: DecisionRow[]) {
  const finished = decisions.find((decision) => decision.action === "approve" || decision.action === "reject")
  if (!finished) return null
  return { label: ACTION_LABELS[finished.action], rationale: finished.rationale }
}

function requestPreview(
  decisions: DecisionRow[],
  messages: MessageRow[],
  input: {
    reference: string
    claimantName: string
    gaps: string[]
    photoGaps: string[]
    dateLine: string | null
  },
) {
  const request = decisions.find((decision) => decision.action === "request")
  if (!request || messages.some((row) => row.decision_id === request.id)) return null
  const preview = requestMessageText({
    reference: input.reference,
    claimantName: input.claimantName,
    rationale: request.rationale,
    gaps: input.gaps,
    photoGaps: input.photoGaps,
    dateLine: input.dateLine,
  })
  return { subject: preview.subject, body: preview.body, decisionId: request.id }
}

function factGroups(facts: FactRow[]) {
  const groups: { file: string; facts: FactRow[] }[] = []
  for (const fact of facts) {
    const last = groups.at(-1)
    if (!last || last.file !== fact.source_file) groups.push({ file: fact.source_file, facts: [fact] })
    else last.facts.push(fact)
  }
  return groups
}

function FactForm({ claimId, fact, corrections }: { claimId: string; fact: FactRow; corrections: CorrectionRow[] }) {
  const latest = corrections.filter((entry) => entry.fact_id === fact.id).at(-1)
  const effective = latest?.corrected_value ?? fact.original_value
  const shown = fact.field === "departure_date" || fact.field === "return_date" ? displayDate(effective) : effective
  const fieldId = fact.fact_key.replaceAll("#", "-")
  const place = fact.leg_index === null ? null : `Leg ${fact.leg_index + 1}`
  return (
    <div className="fact">
      <p>
        <strong>{FIELD_LABELS[fact.field] ?? fact.field}</strong>
        <span> · {shown}</span>
        {place ? <span className="muted"> · {place}</span> : null}
      </p>
      {latest ? (
        <p className="muted">
          Original {fact.original_value} · {latest.rationale}
        </p>
      ) : null}
      {fact.quote_text ? (
        <p>
          {fact.document_id ? <a href={`/claims/${claimId}/files/${fact.document_id}`}>{fact.quote_text}</a> : fact.quote_text}
        </p>
      ) : null}
      <details className="correct">
        <summary>Correct</summary>
        <form action={correctFact}>
          <input name="claim_id" type="hidden" value={claimId} />
          <input name="fact_key" type="hidden" value={fact.fact_key} />
          <label htmlFor={fieldId}>New value</label>
          <input defaultValue={shown} id={fieldId} name="value" required />
          <label htmlFor={`${fieldId}-why`}>Rationale</label>
          <input id={`${fieldId}-why`} name="rationale" required />
          <p>
            <button type="submit">Correct</button>
          </p>
        </form>
      </details>
    </div>
  )
}

function ClaimNotice({ message }: { message: string }) {
  return (
    <section className="panel">
      <h2>Queue</h2>
      <p className={message === CLAIM_READ_ERROR_MESSAGE ? "error" : undefined}>{message}</p>
      <p>
        <a href="/">Back to the queue</a>
      </p>
    </section>
  )
}

function Finding({
  check,
  claimId,
  documents,
}: {
  check: CheckRow
  claimId: string
  documents: DocumentRow[]
}) {
  const quotes = findingQuotes(check)
  return (
    <Fold
      className="finding"
      id={`check-${check.check_name}`}
      startOpen={check.outcome !== "pass"}
      summary={
        <span className="finding-head">
          <h3>{CHECK_LABELS[check.check_name] ?? check.check_name}</h3>
          <span className={`outcome outcome-${check.outcome}`}>{check.outcome}</span>
        </span>
      }
    >
      <p>{findingSummary(check)}</p>
      {quotes.length > 0 ? (
        <ul className="quotes">
          {quotes.map((item, index) => {
            const document = documents.find((entry) => entry.source_file === item.sourceFile)
            return (
              <li key={`${check.check_name}-${index}`}>
                {document ? (
                  <a href={`/claims/${claimId}/files/${document.id}`}>{item.text}</a>
                ) : (
                  item.text
                )}
                {item.flightNumber ? <span className="muted"> · {item.flightNumber}</span> : null}
                {item.sourceFile ? <span className="muted"> · {item.sourceFile}</span> : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </Fold>
  )
}
