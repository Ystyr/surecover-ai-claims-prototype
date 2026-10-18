import { claimUrgent, displayDate, displayInstant, latestCheckFailed } from "@/lib/findings"
import { createClient } from "@/lib/supabase/server"

export default async function QueuePage() {
  const supabase = await createClient()
  const { data: claims, error } = await supabase
    .from("claims")
    .select("id, reference, claimant_name, status, received_at, return_date")
    .order("received_at", { ascending: false })
  const ids = (claims ?? []).map((claim) => claim.id)
  const assessments = !error && ids.length > 0
    ? await supabase
        .from("assessments")
        .select("id, claim_id, created_at, policy_checks(outcome)")
        .in("claim_id", ids)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
    : { data: [], error: null }
  const inbound = !error && ids.length > 0
    ? await supabase.from("inbound_messages").select("claim_id, urgency_noul").in("claim_id", ids)
    : { data: [], error: null }
  const failed = Boolean(error || assessments.error || inbound.error)
  const attention = new Set<string>()
  const seen = new Set<string>()
  for (const assessment of assessments.data ?? []) {
    if (seen.has(assessment.claim_id)) continue
    seen.add(assessment.claim_id)
    const outcomes = (assessment.policy_checks ?? []).map((check) => check.outcome)
    if (latestCheckFailed(outcomes)) attention.add(assessment.claim_id)
  }
  const urgent = new Set<string>()
  const nouls = new Map<string, Array<number | null>>()
  for (const row of inbound.data ?? []) {
    if (!row.claim_id) continue
    const values = nouls.get(row.claim_id) ?? []
    values.push(row.urgency_noul)
    nouls.set(row.claim_id, values)
  }
  for (const [claimId, values] of nouls) {
    if (claimUrgent(values)) urgent.add(claimId)
  }
  const ordered = [...(claims ?? [])].sort((left, right) => Number(urgent.has(right.id)) - Number(urgent.has(left.id)))

  return (
    <section>
      <h2>Queue</h2>
      {failed ? <p className="error">The queue could not be read.</p> : null}
      {!failed && ordered.length === 0 ? <p>No claims are assigned to you.</p> : null}
      {!failed && ordered.map((claim) => (
        <a className="claim-row" href={`/claims/${claim.id}`} key={claim.id}>
          <div className="row-head">
            <strong>{claim.reference}</strong>
            <span>{claim.status}</span>
            {urgent.has(claim.id) ? <span className="urgent">Urgent</span> : null}
            {claim.status === "needs review" ? <span className="needed">Action needed</span> : null}
            {attention.has(claim.id) ? <span className="needed">Check failed</span> : null}
          </div>
          <p>
            {claim.claimant_name} · return {displayDate(claim.return_date)}
          </p>
          <p className="muted">Received {displayInstant(claim.received_at)}</p>
        </a>
      ))}
    </section>
  )
}
