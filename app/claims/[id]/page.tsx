import { correctFact, recordDecision } from "@/app/claims/[id]/actions"
import {
  CHECK_LABELS,
  CLAIM_ABSENT_MESSAGE,
  CLAIM_READ_ERROR_MESSAGE,
  assessmentHistoryNote,
  assessmentOutcomeLine,
  timelineNewestFirst,
  claimPageMessage,
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
  searchParams: Promise<{ correction?: string; decision?: string }>
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

  const [documentResult, assessmentResult, factResult, decisionResult] = await Promise.all([
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
    documentError: documentResult.error || factResult.error || correctionResult.error || decisionResult.error,
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
  const history = (assessments ?? []) as AssessmentRow[]
  const latest = history[0]
  const checks = sortChecks(latest?.policy_checks ?? [])

  return (
    <article>
      <section className="panel">
        <div className="row-head">
          <h2>{claim.reference}</h2>
          <span>{claim.status}</span>
          {claim.status === "needs review" ? <span className="needed">Action needed</span> : null}
        </div>
        <p>
          {claim.claimant_name} · policy {claim.policy_reference} · {claim.policy_version}
        </p>
        <p>
          Return {displayDate(claim.return_date)} · received {displayInstant(claim.received_at)}
        </p>
        {latest ? <p className="muted">Document roles on this assessment come from the {latest.adapter} adapter.</p> : null}
      </section>

      <section>
        <h2>Findings</h2>
        {checks.map((check) => (
          <Finding check={check} claimId={claim.id} documents={files} key={check.check_name} />
        ))}
      </section>

      <section className="panel">
        <h2>Facts</h2>
        <p className="muted">A correction keeps the original quote and recomputes the checks. It does not change the file.</p>
        {query.correction && CORRECTION_MESSAGES[query.correction] ? (
          <p className="error">{CORRECTION_MESSAGES[query.correction]}</p>
        ) : null}
        {facts.length === 0 ? <p>No parsed facts are stored for this claim.</p> : null}
        {facts.map((fact) => (
          <FactForm claimId={claim.id} corrections={corrections} fact={fact} key={fact.id} />
        ))}
      </section>

      <section className="panel">
        <h2>Files</h2>
        <ul className="files">
          {files.map((document) => (
            <li key={document.id}>
              <a href={`/claims/${claim.id}/files/${document.id}`}>{document.source_file}</a>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>History</h2>
        <ul className="history">
          {timelineNewestFirst(decisions, history).map((event) => {
            if (event.kind === "decision") {
              return (
                <li key={event.item.id}>
                  <strong>{displayInstant(event.item.created_at)}</strong>
                  <span> · {ACTION_LABELS[event.item.action]}</span>
                  <div>{event.item.rationale}</div>
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

      <section className="panel">
        <h2>Available actions</h2>
        <DecisionActions
          assessmentId={latest?.id ?? null}
          claimId={claim.id}
          decisions={decisions}
          message={query.decision ? DECISION_MESSAGES[query.decision] : undefined}
        />
      </section>
    </article>
  )
}

function FactForm({ claimId, fact, corrections }: { claimId: string; fact: FactRow; corrections: CorrectionRow[] }) {
  const latest = corrections.filter((entry) => entry.fact_id === fact.id).at(-1)
  const effective = latest?.corrected_value ?? fact.original_value
  const shown = fact.field === "departure_date" || fact.field === "return_date" ? displayDate(effective) : effective
  const fieldId = fact.fact_key.replaceAll("#", "-")
  const place = fact.leg_index === null ? fact.source_file : `${fact.source_file} · leg ${fact.leg_index + 1}`
  return (
    <form action={correctFact} className="fact">
      <h3>{FIELD_LABELS[fact.field] ?? fact.field}</h3>
      <p className="muted">{place}</p>
      <p>
        {latest ? (
          <>
            Original {fact.original_value} · now {effective}
          </>
        ) : (
          <>Value {fact.original_value}</>
        )}
      </p>
      {fact.quote_text ? (
        <p>
          {fact.document_id ? <a href={`/claims/${claimId}/files/${fact.document_id}`}>{fact.quote_text}</a> : fact.quote_text}
        </p>
      ) : null}
      {latest ? <p className="muted">Latest rationale: {latest.rationale}</p> : null}
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
  )
}

function DecisionActions({
  claimId,
  assessmentId,
  decisions,
  message,
}: {
  claimId: string
  assessmentId: string | null
  decisions: DecisionRow[]
  message?: string
}) {
  const finished = decisions.find((decision) => decision.action === "approve" || decision.action === "reject")
  const openActions = finished
    ? []
    : decisions.some((decision) => decision.action === "request")
      ? (["approve", "reject"] as const)
      : DECISION_ACTIONS
  return (
    <>
      {message ? <p className="error">{message}</p> : null}
      {finished ? (
        <p>
          {ACTION_LABELS[finished.action]} · {finished.rationale}
        </p>
      ) : null}
      {assessmentId
        ? openActions.map((action) => (
            <form action={recordDecision} className="decision" key={action}>
              <input name="claim_id" type="hidden" value={claimId} />
              <input name="action" type="hidden" value={action} />
              <input name="assessment_id" type="hidden" value={assessmentId} />
              <label htmlFor={`decision-${action}-why`}>{ACTION_LABELS[action]} rationale</label>
              <input id={`decision-${action}-why`} name="rationale" required />
              <p>
                <button type="submit">{ACTION_LABELS[action]}</button>
              </p>
            </form>
          ))
        : null}
    </>
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
    <section className="finding">
      <div className="finding-head">
        <h3>{CHECK_LABELS[check.check_name] ?? check.check_name}</h3>
        <span className={`outcome outcome-${check.outcome}`}>{check.outcome}</span>
      </div>
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
    </section>
  )
}
