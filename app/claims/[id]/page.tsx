import {
  CHECK_LABELS,
  CLAIM_ABSENT_MESSAGE,
  CLAIM_READ_ERROR_MESSAGE,
  claimPageMessage,
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

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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
            claimError: claimResult.error,
            claim,
            documentError: null,
            assessmentError: null,
          }) ?? CLAIM_ABSENT_MESSAGE
        }
      />
    )
  }

  const [documentResult, assessmentResult] = await Promise.all([
    supabase.from("claim_documents").select("id, source_file, media_type").eq("claim_id", claim.id).order("source_file"),
    supabase
      .from("assessments")
      .select("id, adapter, created_at, policy_checks(check_name, outcome, detail)")
      .eq("claim_id", claim.id)
      .order("created_at", { ascending: false }),
  ])
  const blocked = claimPageMessage({
    claimError: null,
    claim,
    documentError: documentResult.error,
    assessmentError: assessmentResult.error,
  })
  if (blocked) return <ClaimNotice message={blocked} />

  const documents = documentResult.data
  const assessments = assessmentResult.data

  const files = (documents ?? []) as DocumentRow[]
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
          {history.map((assessment, index) => {
            const outcomes = sortChecks(assessment.policy_checks ?? [])
              .map((check) => `${CHECK_LABELS[check.check_name] ?? check.check_name} ${check.outcome}`)
              .join(", ")
            return (
              <li key={assessment.id}>
                <strong>{displayInstant(assessment.created_at)}</strong>
                <span className="muted"> · {assessment.adapter}</span>
                {index === 0 ? <span className="muted"> · shown above</span> : null}
                <div>{outcomes}</div>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="panel">
        <h2>Available actions</h2>
        <div className="actions" aria-label="Available actions">
          <span>Request</span>
          <span>Approve</span>
          <span>Reject</span>
        </div>
        <p className="muted">Recording a decision comes in a later stage.</p>
      </section>
    </article>
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
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
